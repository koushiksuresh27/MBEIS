from fastapi import FastAPI
from fastapi.responses import JSONResponse


app = FastAPI(
    title="Pathogen Profiler Service",
    description=(
        "A service for converting known or emerging pathogen "
        "descriptions into simulation-ready epidemiological parameters "
        "for the Outbreak Response OS."
    ),
    version="1.0.0",
)


@app.get("/", tags=["Root"])
async def root():
    """Basic service information."""
    return {
        "service": "Pathogen Profiler",
        "status": "running",
        "version": "1.0.0",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint used by Render and monitoring systems."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "pathogen_profiler",
        },
    )