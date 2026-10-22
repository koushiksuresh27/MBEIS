import os
import re
import time
import random
import logging
import threading
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from dotenv import load_dotenv
import groq
from groq import Groq, RateLimitError, AuthenticationError

load_dotenv()

logger = logging.getLogger("groq_manager")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [GroqPool] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


@dataclass
class GroqKeySlot:
    slot_id: int
    env_name: str
    key: str
    masked_key: str
    client: Groq
    total_calls: int = 0
    rate_limit_hits: int = 0
    last_rate_limit_time: float = 0.0


class GroqKeyPool:
    """
    Circular queue manager for multiple Groq API keys.
    Features:
    - 1st cycle: When rate limit hits, seamlessly rotates to the next key.
    - Full rotation / 2nd+ cycles: When all keys in the pool are rate-limited,
      it wraps around to the beginning and performs exponential backoff waiting
      before retrying the next cycle.
    - Thread-safe key rotation.
    - Automatic payload 413 / fallback model handling.
    """
    def __init__(
        self,
        base_backoff: float = 2.0,
        max_backoff: float = 30.0,
        max_cycles: int = 5
    ):
        self.base_backoff = base_backoff
        self.max_backoff = max_backoff
        self.max_cycles = max_cycles
        self._lock = threading.Lock()
        self._current_index = 0
        self.slots: List[GroqKeySlot] = []
        self._load_keys()

    def _mask_key(self, key: str) -> str:
        if len(key) <= 12:
            return "gsk_***"
        return f"{key[:8]}...{key[-4:]}"

    def _load_keys(self):
        """Scans environment for GROQ_API_KEY_1..20 and GROQ_API_KEY, preserving uniqueness."""
        found_keys: List[Tuple[str, str]] = []
        seen_keys = set()

        # Check numbered keys first: GROQ_API_KEY_1, GROQ_API_KEY_2, ...
        for i in range(1, 25):
            var_name = f"GROQ_API_KEY_{i}"
            val = os.getenv(var_name, "").strip()
            if val and val not in seen_keys:
                found_keys.append((var_name, val))
                seen_keys.add(val)

        # Also check default GROQ_API_KEY if not already included
        default_val = os.getenv("GROQ_API_KEY", "").strip()
        if default_val and default_val not in seen_keys:
            found_keys.append(("GROQ_API_KEY", default_val))
            seen_keys.add(default_val)

        self.slots = []
        for idx, (env_name, key) in enumerate(found_keys):
            slot = GroqKeySlot(
                slot_id=idx,
                env_name=env_name,
                key=key,
                masked_key=self._mask_key(key),
                client=Groq(api_key=key)
            )
            self.slots.append(slot)

        if self.slots:
            logger.info(
                f"Initialized GroqKeyPool with {len(self.slots)} key(s): "
                f"{', '.join([f'{s.env_name} ({s.masked_key})' for s in self.slots])}"
            )
        else:
            logger.warning("No GROQ API keys found in environment or .env file!")

    def has_keys(self) -> bool:
        return len(self.slots) > 0

    def key_count(self) -> int:
        return len(self.slots)

    def get_current_slot(self) -> GroqKeySlot:
        with self._lock:
            if not self.slots:
                raise RuntimeError("No Groq API keys configured in environment.")
            return self.slots[self._current_index]

    def rotate_to_next(self, reason: str = "") -> GroqKeySlot:
        with self._lock:
            if not self.slots:
                raise RuntimeError("No Groq API keys configured in environment.")
            prev_idx = self._current_index
            self._current_index = (self._current_index + 1) % len(self.slots)
            prev_slot = self.slots[prev_idx]
            new_slot = self.slots[self._current_index]
            logger.info(
                f"Rotating Groq key: [Slot #{prev_idx + 1} {prev_slot.env_name}] -> "
                f"[Slot #{self._current_index + 1} {new_slot.env_name} ({new_slot.masked_key})]. "
                f"Reason: {reason}"
            )
            return new_slot

    @staticmethod
    def is_rate_limit_error(err: Exception) -> bool:
        """Determines if an exception is a rate limit / TPM / RPM error."""
        if isinstance(err, RateLimitError):
            return True
        status_code = getattr(err, "status_code", None)
        if status_code == 429:
            return True
        err_msg = str(err).lower()
        if "rate_limit" in err_msg or "rate limit" in err_msg:
            return True
        if "tokens per minute" in err_msg or "requests per minute" in err_msg or "tpm" in err_msg or "rpm" in err_msg:
            return True
        if "429" in err_msg:
            return True
        return False

    @staticmethod
    def extract_retry_after(err: Exception) -> Optional[float]:
        """Attempts to extract suggested retry delay in seconds from error response."""
        try:
            # Check response headers if present
            response = getattr(err, "response", None)
            if response is not None and hasattr(response, "headers"):
                retry_header = response.headers.get("retry-after")
                if retry_header:
                    return float(retry_header)
            # Regex check in error message for "try again in Xs" or "retry after X seconds"
            match = re.search(r"try again in (\d+(\.\d+)?)s", str(err), re.IGNORECASE)
            if match:
                return float(match.group(1))
            match2 = re.search(r"retry after (\d+(\.\d+)?)", str(err), re.IGNORECASE)
            if match2:
                return float(match2.group(1))
        except Exception:
            pass
        return None

    def create_chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: str = "openai/gpt-oss-120b",
        fallback_model: Optional[str] = "openai/gpt-oss-20b",
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Any] = "auto",
        temperature: float = 0.1,
        parallel_tool_calls: bool = False,
        max_cycles: Optional[int] = None,
        max_backoff: Optional[float] = None,
        **kwargs
    ) -> Any:
        """
        Executes a chat completion call with circular queue key rotation
        and exponential backoff when all keys in a cycle are rate-limited.
        """
        if not self.slots:
            self._load_keys()
            if not self.slots:
                raise RuntimeError("GROQ_API_KEY is not set in environment or .env file.")

        effective_max_cycles = max_cycles if max_cycles is not None else self.max_cycles
        effective_max_backoff = max_backoff if max_backoff is not None else self.max_backoff

        total_keys = len(self.slots)
        current_model = model
        last_exception = None

        for cycle in range(1, effective_max_cycles + 1):
            cycle_rate_limits = 0
            logger.info(f"--- Groq Queue Cycle {cycle}/{effective_max_cycles} (Keys available: {total_keys}) ---")

            # Try each key once in circular order during this cycle
            for step in range(total_keys):
                slot = self.get_current_slot()
                logger.info(
                    f"Attempting request using Key #{slot.slot_id + 1}/{total_keys} "
                    f"({slot.env_name} {slot.masked_key}) with model={current_model}..."
                )

                call_kwargs = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    **kwargs
                }
                if tools is not None:
                    call_kwargs["tools"] = tools
                    call_kwargs["tool_choice"] = tool_choice
                    call_kwargs["parallel_tool_calls"] = parallel_tool_calls

                try:
                    response = slot.client.chat.completions.create(**call_kwargs)
                    slot.total_calls += 1
                    logger.info(
                        f"✓ Groq request successful on {slot.env_name} (Slot #{slot.slot_id + 1})."
                    )
                    return response

                except Exception as err:
                    last_exception = err

                    # 1. Check for 413 / Context length payload limit (switch to fallback model immediately)
                    if fallback_model and current_model != fallback_model and ("413" in str(err) or "context_length" in str(err).lower()):
                        logger.warning(
                            f"Model {current_model} exceeded payload/context limit (413). "
                            f"Falling back immediately to {fallback_model}."
                        )
                        current_model = fallback_model
                        # Retry on same slot with fallback model
                        try:
                            call_kwargs["model"] = current_model
                            response = slot.client.chat.completions.create(**call_kwargs)
                            slot.total_calls += 1
                            logger.info(
                                f"✓ Groq request successful on {slot.env_name} with fallback model {current_model}."
                            )
                            return response
                        except Exception as fb_err:
                            last_exception = fb_err
                            if not self.is_rate_limit_error(fb_err):
                                raise

                    # 2. Check for Rate Limit (TPM / RPM / 429)
                    if self.is_rate_limit_error(err):
                        slot.rate_limit_hits += 1
                        slot.last_rate_limit_time = time.time()
                        cycle_rate_limits += 1

                        retry_after = self.extract_retry_after(err)
                        retry_info = f", Retry-After: {retry_after:.1f}s" if retry_after else ""
                        logger.warning(
                            f"⚠️ Rate limit on {slot.env_name} (Slot #{slot.slot_id + 1}{retry_info}). "
                            f"Advancing to next key in circular queue..."
                        )

                        # "1st cycle -- rate limit goes to next"
                        self.rotate_to_next(reason=f"Rate limit on {slot.env_name}")

                        # If there are more keys left in this cycle, continue immediately
                        if step < total_keys - 1:
                            continue
                        else:
                            # We just exhausted the last key in this cycle
                            break

                    # 3. Invalid authentication or permissions
                    elif isinstance(err, AuthenticationError) or "invalid api key" in str(err).lower():
                        logger.error(
                            f"❌ Authentication failure on {slot.env_name} ({slot.masked_key}): {err}. "
                            f"Skipping this key..."
                        )
                        self.rotate_to_next(reason=f"Auth error on {slot.env_name}")
                        continue

                    # 4. Any other unexpected error (e.g. invalid arguments)
                    else:
                        logger.error(f"❌ Unexpected Groq API error on {slot.env_name}: {err}")
                        # If 120b hit an unexpected TPM format error, try fallback model
                        if fallback_model and current_model != fallback_model and ("tpm" in str(err).lower() or "rate" in str(err).lower()):
                            logger.info(f"Retrying with fallback model {fallback_model}...")
                            current_model = fallback_model
                            continue
                        raise

            # "2nd cycle --> all rate limit comes to 1st still then waits. like a circular queue with exponential backoff."
            if cycle_rate_limits >= total_keys:
                if cycle >= effective_max_cycles:
                    logger.error(
                        f"All {total_keys} Groq API keys rate limited across all {effective_max_cycles} cycles."
                    )
                    break

                # Exponential backoff: base_backoff * 2^(cycle - 1)
                calculated_backoff = self.base_backoff * (2 ** (cycle - 1))
                backoff_wait = min(effective_max_backoff, calculated_backoff) + random.uniform(0.1, 0.6)

                # If last rate limit had retry-after, respect it
                extracted = self.extract_retry_after(last_exception) if last_exception else None
                if extracted and extracted > backoff_wait:
                    backoff_wait = min(effective_max_backoff, extracted + 0.5)

                next_slot = self.get_current_slot()
                logger.warning(
                    f"🛑 All {total_keys} Groq keys are rate-limited in Cycle {cycle}. "
                    f"Circular queue wrapped around to [Slot #{next_slot.slot_id + 1} {next_slot.env_name}]. "
                    f"Waiting {backoff_wait:.2f}s (exponential backoff) before starting Cycle {cycle + 1}..."
                )
                time.sleep(backoff_wait)

                # Also if current model was 120b and hit rate limits everywhere, try 20b on next cycle
                if fallback_model and current_model != fallback_model:
                    logger.info(f"Switching to fallback model {fallback_model} for Cycle {cycle + 1}.")
                    current_model = fallback_model
            else:
                # Some keys succeeded or non-rate-limit occurred
                break

        if last_exception:
            raise last_exception
        raise RuntimeError("All Groq API keys were exhausted without a response.")


    def create_chat_completion_stream(
        self,
        messages: List[Dict[str, Any]],
        model: str = "openai/gpt-oss-120b",
        fallback_model: Optional[str] = "openai/gpt-oss-20b",
        temperature: float = 0.1,
        max_cycles: Optional[int] = None,
        max_backoff: Optional[float] = None,
        **kwargs
    ):
        """
        Executes a streaming chat completion with pre-stream key rotation.
        Yields text deltas (delta.content) as they arrive from Groq.
        """
        if not self.slots:
            self._load_keys()
            if not self.slots:
                raise RuntimeError("GROQ_API_KEY is not set in environment or .env file.")

        effective_max_cycles = max_cycles if max_cycles is not None else self.max_cycles
        effective_max_backoff = max_backoff if max_backoff is not None else self.max_backoff

        total_keys = len(self.slots)
        current_model = model
        last_exception = None

        for cycle in range(1, effective_max_cycles + 1):
            cycle_rate_limits = 0

            for step in range(total_keys):
                slot = self.get_current_slot()
                call_kwargs = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "stream": True,
                    **kwargs
                }

                try:
                    stream_resp = slot.client.chat.completions.create(**call_kwargs)
                    slot.total_calls += 1

                    def token_generator():
                        for chunk in stream_resp:
                            delta = chunk.choices[0].delta if chunk.choices else None
                            if delta and delta.content:
                                yield delta.content

                    return token_generator()

                except Exception as err:
                    last_exception = err

                    # 1. 413 Context limit -> switch to fallback model
                    if fallback_model and current_model != fallback_model and ("413" in str(err) or "context_length" in str(err).lower()):
                        logger.warning(f"Model {current_model} 413, falling back to {fallback_model}...")
                        current_model = fallback_model
                        try:
                            call_kwargs["model"] = current_model
                            stream_resp = slot.client.chat.completions.create(**call_kwargs)
                            slot.total_calls += 1
                            def token_generator():
                                for chunk in stream_resp:
                                    delta = chunk.choices[0].delta if chunk.choices else None
                                    if delta and delta.content:
                                        yield delta.content
                            return token_generator()
                        except Exception as fb_err:
                            last_exception = fb_err
                            if not self.is_rate_limit_error(fb_err):
                                raise

                    # 2. Rate limit pre-stream -> rotate to next key
                    if self.is_rate_limit_error(err):
                        slot.rate_limit_hits += 1
                        slot.last_rate_limit_time = time.time()
                        cycle_rate_limits += 1
                        self.rotate_to_next(reason=f"Rate limit on {slot.env_name}")
                        if step < total_keys - 1:
                            continue
                        else:
                            break
                    elif isinstance(err, AuthenticationError) or "invalid api key" in str(err).lower():
                        self.rotate_to_next(reason=f"Auth error on {slot.env_name}")
                        continue
                    else:
                        raise

            # All keys rate limited in cycle -> exponential backoff
            if cycle_rate_limits >= total_keys:
                if cycle >= effective_max_cycles:
                    break
                calculated_backoff = self.base_backoff * (2 ** (cycle - 1))
                backoff_wait = min(effective_max_backoff, calculated_backoff) + random.uniform(0.1, 0.5)
                logger.warning(f"All Groq keys rate limited in Stream Cycle {cycle}. Waiting {backoff_wait:.2f}s...")
                time.sleep(backoff_wait)
                if fallback_model and current_model != fallback_model:
                    current_model = fallback_model
            else:
                break

        if last_exception:
            raise last_exception
        raise RuntimeError("All Groq API keys were exhausted without a streaming response.")

    def create_chat_completion_voice_stream(
        self,
        messages: List[Dict[str, Any]],
        model: str = "openai/gpt-oss-20b",
        fallback_model: Optional[str] = "openai/gpt-oss-120b",
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Any] = "auto",
        temperature: float = 0.1,
        max_tokens: int = 250,
        max_cycles: int = 2,
        max_backoff: float = 3.0,
        **kwargs
    ):
        """
        Streaming completion for low-latency voice turns. Returns the raw Groq
        stream iterator. Caller is responsible for inspecting the first delta(s)
        to determine whether this is a tool call or plain content.
        Uses a tightened retry budget (max_cycles=2, max_backoff=3.0) appropriate
        for voice latency.
        """
        if not self.slots:
            self._load_keys()
            if not self.slots:
                raise RuntimeError("GROQ_API_KEY is not set in environment or .env file.")

        total_keys = len(self.slots)
        current_model = model
        last_exception = None

        for cycle in range(1, max_cycles + 1):
            cycle_rate_limits = 0

            for step in range(total_keys):
                slot = self.get_current_slot()
                call_kwargs = {
                    "model": current_model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                    **kwargs
                }
                if tools is not None:
                    call_kwargs["tools"] = tools
                    call_kwargs["tool_choice"] = tool_choice

                try:
                    stream_resp = slot.client.chat.completions.create(**call_kwargs)
                    slot.total_calls += 1
                    logger.info(
                        f"✓ Groq voice stream started on {slot.env_name} with {current_model}."
                    )
                    return stream_resp

                except Exception as err:
                    last_exception = err

                    # 1. 413 / Context length payload limit
                    if fallback_model and current_model != fallback_model and ("413" in str(err) or "context_length" in str(err).lower()):
                        logger.warning(
                            f"Model {current_model} exceeded payload limit. Falling back to {fallback_model}."
                        )
                        current_model = fallback_model
                        try:
                            call_kwargs["model"] = current_model
                            stream_resp = slot.client.chat.completions.create(**call_kwargs)
                            slot.total_calls += 1
                            return stream_resp
                        except Exception as fb_err:
                            last_exception = fb_err
                            if not self.is_rate_limit_error(fb_err):
                                raise

                    # 2. Rate limit -> rotate to next key
                    if self.is_rate_limit_error(err):
                        slot.rate_limit_hits += 1
                        slot.last_rate_limit_time = time.time()
                        cycle_rate_limits += 1
                        self.rotate_to_next(reason=f"Rate limit on {slot.env_name}")
                        if step < total_keys - 1:
                            continue
                        else:
                            break
                    elif isinstance(err, AuthenticationError) or "invalid api key" in str(err).lower():
                        self.rotate_to_next(reason=f"Auth error on {slot.env_name}")
                        continue
                    else:
                        raise

            # All keys rate limited in cycle -> exponential backoff with tight max_backoff
            if cycle_rate_limits >= total_keys:
                if cycle >= max_cycles:
                    break
                calculated_backoff = self.base_backoff * (2 ** (cycle - 1))
                backoff_wait = min(max_backoff, calculated_backoff) + random.uniform(0.1, 0.4)
                logger.warning(f"All Groq keys rate limited in Voice Stream Cycle {cycle}. Waiting {backoff_wait:.2f}s...")
                time.sleep(backoff_wait)
                if fallback_model and current_model != fallback_model:
                    current_model = fallback_model
            else:
                break

        if last_exception:
            raise last_exception
        raise RuntimeError("All Groq API keys were exhausted without a voice streaming response.")


# Global singleton instance for application-wide key pool
groq_pool = GroqKeyPool()
