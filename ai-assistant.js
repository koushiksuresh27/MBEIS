// Extracted from workflow-server.js
// Groq model: llama-3.3-70b-versatile
// Supabase tables queried: complaints, chronic_issues, technicians, equipment, vendors, ratings, root_cause_tickets, complaint_logs
// Endpoint(s): POST /agent/chat, POST /agent/briefing
// Env vars required: GROQ_API_KEY_1, GROQ_API_KEY_2, SUPABASE_URL, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, SARVAM_API_KEY

const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const groqClients = [
  new Groq({ apiKey: process.env.GROQ_API_KEY_1 }),
  new Groq({ apiKey: process.env.GROQ_API_KEY_2 }),
];
let groqIndex = 0;

async function callLLM(messages, options = {}, maxTokens = 1000, model = 'llama-3.3-70b-versatile') {
  const attempts = groqClients.length;
  for (let i = 0; i < attempts; i++) {
    const client = groqClients[groqIndex % groqClients.length];
    groqIndex++;
    try {
      const params = {
        model,
        messages,
        max_tokens: maxTokens,
      };
      const toolsArray = Array.isArray(options) ? options : options?.tools;
      if (Array.isArray(toolsArray) && toolsArray.length > 0) {
        params.tools = toolsArray;
        params.tool_choice = options?.tool_choice ?? 'auto';
        if (options?.parallel_tool_calls !== undefined) {
          params.parallel_tool_calls = options.parallel_tool_calls;
        }
      }
      if (options?.temperature !== undefined) {
        params.temperature = options.temperature;
      }
      return await client.chat.completions.create(params);
    } catch (err) {
      if (err?.status === 429) {
        console.log(`Groq key ${i + 1} rate limited, trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('All Groq keys rate limited. Wait 1 minute.');
}

async function detectLanguage(text) {
  try {
    const response = await fetch(
      'https://api.sarvam.ai/text-lid',
      {
        method: 'POST',
        headers: {
          'api-subscription-key': process.env.SARVAM_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: text
        })
      }
    );

    if (!response.ok) {
      console.error('[LANG-ID] Failed:', response.status);
      return null;
    }

    const data = await response.json();
    return data.language_code || null;
  } catch (err) {
    return null;
  }
}

const agentTools = [
  {
    type: 'function',
    function: {
      name: 'get_complaints',
      description: 'Get complaints for the society with optional filters. Use this when admin asks about complaints, pending issues, or maintenance requests.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status: open, assigned, in_progress, resolved, closed, escalated',
            enum: ['open', 'assigned', 'in_progress', 'resolved', 'closed', 'escalated', 'all']
          },
          priority: {
            type: 'string',
            description: 'Filter by priority level',
            enum: ['low', 'medium', 'high', 'critical', 'all']
          },
          limit: {
            type: 'integer',
            description: 'Number of complaints to return, default 10, max 20'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chronic_issues',
      description: 'Get chronic/recurring issues detected by the DNA pipeline. Use when admin asks about recurring problems, chronic issues, or pattern-detected failures.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status',
            enum: ['active', 'investigating', 'resolved', 'all']
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_technicians',
      description: 'Get technician list with performance metrics and current workload. Use when admin asks about technician availability, performance, or assignment recommendations.',
      parameters: {
        type: 'object',
        properties: {
          available_only: {
            type: 'boolean',
            description: 'If true, return only available technicians. Must be boolean true or false, never a string.'
          },
          specialization: {
            type: 'string',
            description: 'Filter by specialization e.g. Plumbing, Electrical. Omit this field entirely if not filtering by specialization.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_equipment_health',
      description: 'Get equipment health status for the society. Use when admin asks about equipment, machinery, lifts, generators, pumps etc.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by health status',
            enum: ['operational', 'needs_attention', 'critical', 'all']
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_vendors',
      description: 'Get vendor/contractor information including contract expiry dates and costs. Use when admin asks about vendors, AMC contracts, or service providers.',
      parameters: {
        type: 'object',
        properties: {
          expiring_soon: {
            type: 'boolean',
            description: 'If true, return only vendors with contracts expiring within 30 days'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sla_status',
      description: 'Get SLA compliance status and overdue complaints. Use when admin asks about SLA breaches, overdue issues, or deadline compliance.',
      parameters: {
        type: 'object',
        properties: {
          overdue_only: {
            type: 'boolean',
            description: 'If true, return only overdue complaints'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_society_stats',
      description: 'Get overall society statistics for the current month. Use when admin asks for a summary, overview, "how are we doing" type questions, or any general status check.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Time period for stats',
            enum: ['today', 'week', 'month']
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_root_cause_tickets',
      description: 'Get open root cause investigation tickets. Use when admin asks about root cause analysis or investigation tickets.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'investigating', 'awaiting_vendor', 'resolved', 'all']
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_complaint',
      description: 'Create a brand new complaint that an admin personally observed (not reported by a resident). Use this when the admin describes an issue they saw and wants it logged, optionally assigning it to a technician immediately.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the issue' },
          description: { type: 'string', description: 'Details of what was observed' },
          category: { type: 'string', enum: ['Plumbing','Electrical','Carpentry','HVAC','Civil','Housekeeping','Lift','Security','Common Area','Other'] },
          priority: { type: 'string', enum: ['low','medium','high','critical'] },
          location: { type: 'string', description: 'Where this is, e.g. "Lobby", "Tower B basement". Default to "Common Area" if not specified.' },
          technician_name: { type: 'string', description: 'Name of technician to assign immediately, if mentioned. Omit if not specified.' }
        },
        required: ['title', 'description', 'category', 'priority']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'assign_complaint',
      description: 'AGENT MODE ONLY. Assign a complaint to a specific technician. Use when admin explicitly asks to assign a complaint.',
      parameters: {
        type: 'object',
        properties: {
          complaint_id: { type: 'string', description: 'UUID of the complaint to assign' },
          technician_id: { type: 'string', description: 'UUID of the technician to assign to' },
          reason: { type: 'string', description: 'Reason for this assignment' }
        },
        required: ['complaint_id', 'technician_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp_to_technician',
      description: 'AGENT MODE ONLY. Send a WhatsApp message to a technician. Use when admin wants to notify or message a technician.',
      parameters: {
        type: 'object',
        properties: {
          technician_name: { type: 'string', description: 'Name of the technician' },
          phone: { type: 'string', description: 'Phone number with country code' },
          message: { type: 'string', description: 'Message to send' }
        },
        required: ['phone', 'message', 'technician_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_maintenance_schedule',
      description: 'AGENT MODE ONLY. Create a preventive maintenance task. Use when admin wants to schedule maintenance.',
      parameters: {
        type: 'object',
        properties: {
          task_name: { type: 'string', description: 'Name of the maintenance task' },
          category: { type: 'string', description: 'Category of maintenance' },
          next_due: { type: 'string', description: 'Due date in ISO format' },
          notes: { type: 'string', description: 'Additional notes' }
        },
        required: ['task_name', 'category', 'next_due']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_root_cause_ticket',
      description: 'AGENT MODE ONLY. Update a root cause investigation ticket status or add documentation.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', description: 'UUID of the root cause ticket' },
          status: { type: 'string', enum: ['open', 'investigating', 'awaiting_vendor', 'resolved'] },
          root_cause_documented: { type: 'string', description: 'Documentation of root cause' },
          amc_notified: { type: 'boolean', description: 'Whether AMC vendor was notified' }
        },
        required: ['ticket_id']
      }
    }
  }
];

async function executeTool(toolName, args, societyId, adminId) {
  if (!args || typeof args !== 'object') {
    args = {}
  }
  if (args.limit !== undefined) {
    args.limit = parseInt(args.limit) || 10
  }
  if (args.available_only !== undefined) {
    args.available_only =
      args.available_only === true ||
      args.available_only === 'true'
  }
  if (args.overdue_only !== undefined) {
    args.overdue_only =
      args.overdue_only === true ||
      args.overdue_only === 'true'
  }
  if (args.expiring_soon !== undefined) {
    args.expiring_soon =
      args.expiring_soon === true ||
      args.expiring_soon === 'true'
  }

  console.log(`[AGENT] Executing tool: ${toolName}`, args)

  switch (toolName) {
    case 'create_complaint': {
      let assignedTechId = null
      let assignedTechName = null

      if (args.technician_name) {
        const { data: techs } = await supabaseAdmin
          .from('technicians')
          .select('id, users(name, phone)')
          .eq('society_id', societyId)

        const match = techs?.find(t =>
          t.users?.name?.toLowerCase()
            .includes(args.technician_name.toLowerCase()))

        if (match) {
          assignedTechId = match.id
          assignedTechName = match.users?.name
        }
      }

      const slaHours = { critical: 2, high: 4, medium: 8, low: 24 }
      const slaDeadline = new Date(
        Date.now() + (slaHours[args.priority] || 8) * 60 * 60 * 1000
      ).toISOString()

      const detectedLang = args.description
        ? await detectLanguage(args.description)
        : null
      console.log('[CREATE-COMPLAINT] Detected language:', detectedLang)

      const { data: complaint, error } = await supabaseAdmin
        .from('complaints')
        .insert({
          society_id: societyId,
          submitted_by: adminId,
          type: 'personal',
          title: args.title,
          description: args.description,
          category: args.category,
          priority: args.priority,
          flat_number: args.location || 'Common Area',
          status: assignedTechId ? 'assigned' : 'open',
          assigned_tech_id: assignedTechId,
          sla_deadline: slaDeadline,
          detected_language: detectedLang
        })
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      // runDNAPipeline(complaint) // DNA pipeline omitted for standalone assistant

      return {
        success: true,
        action: 'complaint_created',
        complaint_id: complaint.id,
        assigned_to: assignedTechName,
        message: assignedTechId
          ? `Created and assigned to ${assignedTechName}`
          : `Created, currently unassigned`
      }
    }

    case 'get_complaints': {
      const safeArgs = args
      let query = supabaseAdmin.from('complaints')
        .select(`
          id, title, category, priority,
          status, created_at, sla_deadline,
          submitted_by_user:users!complaints_submitted_by_fkey(name),
          assigned_tech:technicians(
            users(name)
          )
        `)
        .eq('society_id', societyId)
        .order('created_at', { ascending: false })
        .limit(parseInt(safeArgs.limit) || 10)

      if (safeArgs.status && safeArgs.status !== 'all') {
        query = query.eq('status', safeArgs.status)
      }
      if (safeArgs.priority && safeArgs.priority !== 'all') {
        query = query.eq('priority', safeArgs.priority)
      }

      const { data } = await query
      return {
        count: data?.length || 0,
        complaints: data?.map(c => ({
          id: c.id,
          title: c.title,
          category: c.category,
          priority: c.priority,
          status: c.status,
          submitted_by: c.submitted_by_user?.name,
          assigned_to: c.assigned_tech?.users?.name || 'Unassigned',
          sla_deadline: c.sla_deadline,
          is_overdue: new Date(c.sla_deadline) < new Date(),
          created_at: c.created_at
        })) || []
      }
    }

    case 'get_chronic_issues': {
      const safeArgs = args || {}
      let query = supabaseAdmin.from('chronic_issues')
        .select(`
          *,
          root_cause_tickets(
            id, title, status,
            root_cause_documented,
            amc_notified
          )
        `)
        .eq('society_id', societyId)
        .order('severity', { ascending: true })

      if (safeArgs.status && safeArgs.status !== 'all') {
        query = query.eq('status', safeArgs.status)
      }

      const { data } = await query
      return {
        count: data?.length || 0,
        chronic_issues: data?.map(i => ({
          id: i.id,
          asset: i.asset_type,
          fault: i.fault_type,
          location: i.location,
          occurrences: i.occurrence_count,
          severity: i.severity,
          status: i.status,
          first_reported: i.first_reported,
          last_reported: i.last_reported,
          estimated_cost_saved: i.estimated_cost_saved,
          root_cause_ticket: i.root_cause_tickets?.[0] || null
        })) || []
      }
    }

    case 'get_technicians': {
      const safeArgs = args || {}
      let query = supabaseAdmin
        .from('technicians')
        .select(`
          id, specializations,
          performance_score, is_available,
          users(name, phone)
        `)
        .eq('society_id', societyId)

      if (safeArgs.available_only) {
        query = query.eq('is_available', true)
      }

      console.log('[TOOL get_technicians] society_id:', societyId, 'available_only:', safeArgs.available_only, 'specialization filter:', safeArgs.specialization || 'none')

      const { data: techs, error: techsError } = await query

      console.log('[TOOL get_technicians] raw query returned', techs?.length ?? 0, 'rows, error:', techsError?.message || null)
      if (techs?.length) console.log('[TOOL get_technicians] first row sample:', JSON.stringify(techs[0]))

      const techsWithWorkload = await Promise.all(
        (techs || []).map(async (tech) => {
          const { count } = await supabaseAdmin.from('complaints')
            .select('*', { count: 'exact' })
            .eq('assigned_tech_id', tech.id)
            .not('status', 'in', '("closed","verified","resolved")')

          const { data: ratings } = await supabaseAdmin.from('ratings')
            .select('score')
            .eq('technician_id', tech.id)

          const avgRating = ratings?.length > 0
            ? (ratings.reduce(
              (sum, r) => sum + r.score, 0
            ) / ratings.length).toFixed(1)
            : 'No ratings yet'

          return {
            id: tech.id,
            name: tech.users?.name,
            phone: tech.users?.phone,
            specializations: tech.specializations,
            performance_score: tech.performance_score,
            is_available: tech.is_available,
            current_workload: count || 0,
            average_rating: avgRating,
            ...(safeArgs.specialization && {
              matches_specialization: tech.specializations?.some(s =>
                s.toLowerCase().includes(safeArgs.specialization.toLowerCase())
              )
            })
          }
        })
      )

      console.log('[TOOL get_technicians] returning', techsWithWorkload.length, 'technicians with ids:', techsWithWorkload.map(t => ({ id: t.id, name: t.name, is_available: t.is_available })))

      return {
        count: techsWithWorkload.length,
        technicians: techsWithWorkload.sort(
          (a, b) => a.current_workload - b.current_workload
        )
      }
    }

    case 'get_equipment_health': {
      const safeArgs = args || {}
      let query = supabaseAdmin.from('equipment')
        .select('*')
        .eq('society_id', societyId)

      if (safeArgs.status && safeArgs.status !== 'all') {
        query = query.eq('status', safeArgs.status)
      }

      const { data } = await query
      return {
        count: data?.length || 0,
        equipment: data?.map(e => ({
          name: e.name,
          location: e.location,
          status: e.status,
          last_inspected: e.last_inspected,
          next_inspection: e.next_inspection,
          is_overdue_inspection: e.next_inspection
            ? new Date(e.next_inspection) < new Date()
            : false,
          notes: e.notes
        })) || [],
        summary: {
          operational: data?.filter(e => e.status === 'operational').length || 0,
          needs_attention: data?.filter(e => e.status === 'needs_attention').length || 0,
          critical: data?.filter(e => e.status === 'critical').length || 0
        }
      }
    }

    case 'get_vendors': {
      const safeArgs = args || {}
      let query = supabaseAdmin.from('vendors')
        .select('*')
        .eq('society_id', societyId)

      const { data } = await query

      const now = new Date()
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      let vendors = data || []
      if (safeArgs.expiring_soon) {
        vendors = vendors.filter(v => {
          if (!v.contract_end_date) return false
          const expiry = new Date(v.contract_end_date)
          return expiry <= in30Days && expiry >= now
        })
      }

      return {
        count: vendors.length,
        vendors: vendors.map(v => ({
          name: v.company_name,
          service_type: v.service_type,
          contact: v.contact_name,
          phone: v.contact_phone,
          contract_expiry: v.contract_end_date,
          monthly_cost: v.contract_cost,
          rating: v.rating,
          status: v.status,
          days_until_expiry: v.contract_end_date
            ? Math.ceil(
              (new Date(v.contract_end_date) - now) / (1000 * 60 * 60 * 24)
            )
            : null
        }))
      }
    }

    case 'get_sla_status': {
      const safeArgs = args || {}
      const now = new Date().toISOString()

      let query = supabaseAdmin.from('complaints')
        .select(`
          id, title, category, priority,
          status, sla_deadline, created_at,
          assigned_tech:technicians(
            users(name)
          )
        `)
        .eq('society_id', societyId)
        .not('status', 'in', '("closed","verified")')

      if (safeArgs.overdue_only) {
        query = query.lt('sla_deadline', now)
      }

      const { data } = await query
      const overdue = data?.filter(c =>
        new Date(c.sla_deadline) < new Date()
      ) || []

      return {
        total_open: data?.length || 0,
        overdue_count: overdue.length,
        sla_compliance_rate: data?.length > 0
          ? (((data.length - overdue.length) / data.length) * 100).toFixed(1) + '%'
          : '100%',
        overdue_complaints: overdue.map(c => ({
          title: c.title,
          category: c.category,
          priority: c.priority,
          assigned_to: c.assigned_tech?.users?.name || 'Unassigned',
          hours_overdue: Math.ceil(
            (new Date() - new Date(c.sla_deadline)) / (1000 * 60 * 60)
          ),
          sla_deadline: c.sla_deadline
        }))
      }
    }

    case 'get_society_stats': {
      const safeArgs = args || {}
      const now = new Date()
      let startDate = new Date()

      if (safeArgs.period === 'today') {
        startDate.setHours(0, 0, 0, 0)
      } else if (safeArgs.period === 'week') {
        startDate.setDate(now.getDate() - 7)
      } else {
        startDate.setDate(1) // start of month
      }

      const [
        { count: totalComplaints },
        { count: resolvedComplaints },
        { count: openComplaints },
        { count: chronicCount },
        { data: techData }
      ] = await Promise.all([
        supabaseAdmin.from('complaints')
          .select('*', { count: 'exact' })
          .eq('society_id', societyId)
          .gte('created_at', startDate.toISOString()),
        supabaseAdmin.from('complaints')
          .select('*', { count: 'exact' })
          .eq('society_id', societyId)
          .in('status', ['closed', 'verified'])
          .gte('created_at', startDate.toISOString()),
        supabaseAdmin.from('complaints')
          .select('*', { count: 'exact' })
          .eq('society_id', societyId)
          .in('status', ['open', 'assigned', 'in_progress', 'accepted']),
        supabaseAdmin.from('chronic_issues')
          .select('*', { count: 'exact' })
          .eq('society_id', societyId)
          .eq('status', 'active'),
        supabaseAdmin.from('technicians')
          .select('performance_score')
          .eq('society_id', societyId)
      ])

      const avgScore = techData?.length > 0
        ? (techData.reduce(
          (sum, t) => sum + t.performance_score, 0
        ) / techData.length).toFixed(1)
        : 0

      const resolutionRate = totalComplaints > 0
        ? ((resolvedComplaints / totalComplaints) * 100).toFixed(1)
        : 0

      return {
        period: safeArgs.period || 'month',
        total_complaints: totalComplaints,
        resolved_complaints: resolvedComplaints,
        open_complaints: openComplaints,
        resolution_rate: resolutionRate + '%',
        chronic_issues_active: chronicCount,
        avg_technician_score: avgScore,
        estimated_cost_saved: chronicCount * 15000
      }
    }

    case 'get_root_cause_tickets': {
      const safeArgs = args || {}
      let query = supabaseAdmin.from('root_cause_tickets')
        .select(`
          *,
          chronic_issues(
            asset_type, fault_type,
            severity, occurrence_count
          )
        `)
        .eq('society_id', societyId)

      if (safeArgs.status && safeArgs.status !== 'all') {
        query = query.eq('status', safeArgs.status)
      }

      const { data } = await query
      return {
        count: data?.length || 0,
        tickets: data?.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          asset: t.chronic_issues?.asset_type,
          severity: t.chronic_issues?.severity,
          occurrences: t.chronic_issues?.occurrence_count,
          root_cause_documented: !!t.root_cause_documented,
          amc_notified: t.amc_notified,
          created_at: t.created_at
        })) || []
      }
    }

    case 'assign_complaint': {
      try {
        console.log('[AGENT ACTION] assign_complaint — fetching complaint id:', args.complaint_id)
        const { data: existingComplaint, error: fetchError } = await supabaseAdmin.from('complaints')
          .select('id, submitted_by, status')
          .eq('id', args.complaint_id)
          .single()

        if (fetchError || !existingComplaint) {
          console.error('[AGENT ACTION] Failed to fetch complaint:', fetchError)
          return { success: false, error: `Complaint not found: ${fetchError?.message || 'no data returned'}` }
        }

        const oldStatus = existingComplaint.status || 'open'
        
        console.log('[AGENT ACTION] Updating complaint, assigning technician_id:', args.technician_id)
        const { error: updateError } = await supabaseAdmin.from('complaints')
          .update({
            assigned_tech_id: args.technician_id,
            status: 'assigned',
            updated_at: new Date().toISOString()
          })
          .eq('id', args.complaint_id)

        if (updateError) {
          console.error('[AGENT ACTION] Failed to update complaint:', updateError)
          return { success: false, error: `Failed to update complaint: ${updateError.message}` }
        }

        const { error: logError } = await supabaseAdmin.from('complaint_logs')
          .insert({
            complaint_id: args.complaint_id,
            actor_id: existingComplaint.submitted_by,
            action: 'assigned_by_agent',
            old_status: oldStatus,
            new_status: 'assigned',
            note: `Assigned by Aria Agent. Reason: ${args.reason || 'Admin requested via agent'}`
          })

        const { data: tech } = await supabaseAdmin
          .from('technicians')
          .select('users(name, phone)')
          .eq('id', args.technician_id)
          .single()

        const techName = tech?.users?.name || args.technician_id
        console.log(`[AGENT ACTION] Complaint ${args.complaint_id} successfully assigned to ${techName}`)

        return {
          success: true,
          action: 'complaint_assigned',
          complaint_id: args.complaint_id,
          assigned_to: techName,
          message: `Complaint successfully assigned to ${techName}`
        }
      } catch (err) {
        console.error('[AGENT ACTION] assign_complaint crashed:', err)
        return { success: false, error: err.message }
      }
    }

    case 'send_whatsapp_to_technician': {
      const accountSid = process.env.TWILIO_ACCOUNT_SID
      const authToken = process.env.TWILIO_AUTH_TOKEN
      const from = process.env.TWILIO_WHATSAPP_FROM
      const encoded = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

      try {
        await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${encoded}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              From: `whatsapp:${from}`,
              To: `whatsapp:${args.phone}`,
              Body: args.message
            })
          }
        )
        return {
          success: true,
          action: 'whatsapp_sent',
          sent_to: args.technician_name,
          message: `WhatsApp sent to ${args.technician_name}`
        }
      } catch (err) {
        return { success: false, error: 'WhatsApp send failed', details: err.message }
      }
    }

    case 'create_maintenance_schedule': {
      const { data } = await supabaseAdmin.from('maintenance_schedules')
        .insert({
          society_id: societyId,
          task_name: args.task_name,
          category: args.category,
          next_due: args.next_due,
          notes: args.notes,
          status: 'upcoming',
          frequency: 'one_time'
        })
        .select()
        .single()
      return {
        success: true,
        action: 'schedule_created',
        task: args.task_name,
        due: args.next_due,
        message: `Maintenance task "${args.task_name}" scheduled for ${new Date(args.next_due).toLocaleDateString('en-IN')}`
      }
    }

    case 'update_root_cause_ticket': {
      const updateData = { updated_at: new Date().toISOString() }
      if (args.status) updateData.status = args.status
      if (args.root_cause_documented) updateData.root_cause_documented = args.root_cause_documented
      if (args.amc_notified !== undefined) updateData.amc_notified = args.amc_notified
      if (args.status === 'resolved') updateData.resolved_at = new Date().toISOString()

      const { data } = await supabaseAdmin.from('root_cause_tickets')
        .update(updateData)
        .eq('id', args.ticket_id)
        .select()
        .single()
      return {
        success: true,
        action: 'ticket_updated',
        ticket_id: args.ticket_id,
        new_status: args.status,
        message: `Root cause ticket updated to: ${args.status}`
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }

  }
}

async function getProactiveContext(societyId) {

  const safeExecute = async (tool, args) => {
    try {
      return await executeTool(tool, args || {}, societyId)
    } catch (err) {
      console.error(`[CONTEXT] Tool ${tool} failed:`, err.message)
      return {}
    }
  }

  const [chronic, sla, stats, equipment, techs] = await Promise.all([
    safeExecute('get_chronic_issues', { status: 'active' }),
    safeExecute('get_sla_status', { overdue_only: true }),
    safeExecute('get_society_stats', { period: 'week' }),
    safeExecute('get_equipment_health', { status: 'all' }),
    safeExecute('get_technicians', { available_only: false, specialization: null })
  ])

  const criticalEquipment = equipment.equipment?.filter(e =>
    e.status === 'critical' || e.status === 'needs_attention'
  ) || []

  const currentMonth = new Date().getMonth()
  const isMonsoon = currentMonth >= 5 && currentMonth <= 8
  const isWinter = currentMonth >= 10 || currentMonth <= 1

  return {
    summary: \`
LIVE SOCIETY STATUS:
━━━━━━━━━━━━━━━━━━━
Chronic Issues: \${chronic.count || 0} active
\${chronic.chronic_issues?.map(i =>
      \`  • \${i.asset} (\${i.severity}, \${i.occurrences}x in 30 days)\`
    ).join('\\n') || '  None'}

Overdue Complaints: \${sla.overdue_count || 0}
SLA Compliance: \${sla.sla_compliance_rate || 'N/A'}
\${sla.overdue_complaints?.length > 0
        ? sla.overdue_complaints.map(c =>
          \`  • \${c.title} — \${c.hours_overdue}h overdue\`
        ).join('\\n')
        : '  All within SLA ✅'}

This Week:
  Complaints: \${stats.total_complaints || 0} total
  Resolved: \${stats.resolved_complaints || 0} (\${stats.resolution_rate || '0%'})
  Open: \${stats.open_complaints || 0}

Equipment Alerts: \${criticalEquipment.length}
\${criticalEquipment.map(e =>
          \`  • \${e.name} — \${e.status}\`
        ).join('\\n') || '  All operational ✅'}

Technicians: \${techs.count || 0} total, \${techs.technicians?.filter(t => t.is_available).length || 0} available

Season: \${isMonsoon
        ? '🌧️ MONSOON — Water/drainage issues likely'
        : isWinter
          ? '❄️ WINTER — Heating system checks needed'
          : '☀️ Normal season'}
    \`.trim(),
    chronic,
    sla,
    stats,
    equipment,
    techs,
    isMonsoon,
    isWinter,
    criticalEquipment
  }
}

async function runEstateManagerAgent(
  message, 
  societyId, 
  conversationHistory = [], 
  plan = 'free',
  responseLanguage = 'English',
  adminId = null
) {
  console.log(\`[AGENT] Processing: "\${message}"\`)

  console.log(\`[AGENT] Loading society context...\`)
  const context = await getProactiveContext(societyId)

  const currentTime = new Date().toLocaleString('en-IN', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  const languageInstruction = 
    responseLanguage === 'English'
      ? ''
      : \`\\n\\nCRITICAL LANGUAGE INSTRUCTION: 
You MUST respond ENTIRELY in \${responseLanguage}. 
Do not mix English and \${responseLanguage} 
unless a technical term has no good 
\${responseLanguage} equivalent (e.g. 
"WhatsApp", "SLA", "AMC" can stay in English). 
Numbers, dates, and proper nouns 
(names like "John", "Kumar") stay as is. 
Every sentence of your response must be 
in \${responseLanguage}.\\n\\n\`

  const isAgentMode = plan === 'growth'

  const planContext = isAgentMode
    ? \`
AGENT MODE ACTIVE 🤖

🚨 CRITICAL RULE — NO HALLUCINATION OF ACTIONS:
You must NEVER claim to have performed an action (assigned a complaint, sent a WhatsApp message, created a schedule, updated a ticket) unless you have ACTUALLY called the corresponding tool function in THIS SAME turn and received a successful tool result.

If the user asks you to perform an action:
1. Call the appropriate tool IMMEDIATELY — do not describe what you are about to do, just call it
2. Wait for the actual tool result
3. ONLY THEN report what happened, based on the real tool result

If you are missing required information (like a technician ID, complaint ID, or phone number), ask ONE clarifying question to get it. Do NOT fabricate IDs or describe a fake action.

🚨 TECHNICIAN NAME RESOLUTION RULE:
If the admin refers to a technician by name (e.g. "assign to John"), you MUST call get_technicians first to retrieve their UUID before calling an action tool. Do NOT guess or make up a UUID.

NEVER write a response that describes an action as done or in progress without a successful tool call result backing it. This is a hard requirement.

Available action tools (call them directly when asked):
  ✅ assign_complaint(complaint_id, technician_id, reason?)
  ✅ send_whatsapp_to_technician(phone, message, technician_name)
  ✅ create_maintenance_schedule(task_name, category, next_due, notes?)
  ✅ update_root_cause_ticket(ticket_id, status?, root_cause_documented?, amc_notified?)\`
    : \`
ASSISTANT MODE ACTIVE 📖
You can READ data and give recommendations.
You CANNOT take actions directly.

If admin asks you to DO something (assign, send, create, update):
Respond with:
"🔒 I can recommend this action, but taking it directly requires Agent Mode (Growth Plan).

Here's what to do manually:
[specific step by step instructions]

Upgrade to Growth Plan to let me handle this automatically."

DO NOT call action tools in assistant mode.
Only call: get_complaints, get_chronic_issues, get_technicians, get_vendors, get_sla_status, get_society_stats, get_root_cause_tickets

When using tools, call them silently. Never announce tool usage in your response text.\`

  const systemPrompt = \`CRITICAL FORMATTING RULES - NEVER VIOLATE:
1. NEVER write <function=anything> in your 
   response text under any circumstances.
2. NEVER write [function=anything] in your 
   response text.
3. NEVER describe what tool you are about to 
   call in your response text.
4. NEVER say "मैं <function=...> का उपयोग करके" 
   or any equivalent in any language.
5. Tool calls happen automatically and invisibly.
   Your response text must ONLY contain the 
   final answer to the user — never the process.
6. These rules apply in English, Hindi, Kannada, 
   Tamil, Telugu, and ALL other languages.
7. If you catch yourself about to write a 
   function tag, STOP and just write the 
   answer directly instead.

You are Aria — BlockFlow's Estate Operations Intelligence for this residential society.

You are NOT a generic chatbot. You are a seasoned facility management expert with deep knowledge of Indian residential societies, AMC contracts, monsoon preparedness, and infrastructure maintenance.

\${context.summary}
\${languageInstruction}
\${planContext}

At the start of every conversation turn, 
you receive preloaded context including 
technician availability, SLA status, chronic 
issues, and society stats. USE THIS DATA to 
answer questions directly without calling 
additional tools. Only call tools when you 
need data NOT already in the preloaded context.

Example: If asked 'which technician is free?' 
use the technicians data already loaded — 
do not call get_technicians again. Just answer 
from the context you already have.

YOUR CORE BEHAVIOR:
1. You have the above live data already loaded
2. Use your tools ONLY when you need ADDITIONAL specific data not shown above
3. Never say "I don't have access to that" — use your tools
4. Always connect dots: if someone asks about a lift complaint, also check if it's a chronic issue
5. Think like an estate manager, not a search engine

YOUR PERSONALITY — ARIA:
- Direct and decisive — give recommendations, not just data
- Proactive — mention related issues the admin didn't ask about
- Cost-conscious — always mention ₹ implications when relevant
- India-aware — understand AMC, society committees, monsoon, festive season impacts
- Concise — under 180 words, always
- Warm but professional

RESPONSE FORMAT — ALWAYS:
🚨 for critical/urgent items
⚠️ for warnings/watch items
📋 for informational items
✅ for good news/all clear

End EVERY response with:
"→ Next action: [one specific thing to do right now]"

WHAT YOU CAN DO:
✓ Analyze complaint patterns and chronic issues
✓ Recommend technician assignments with reasoning
✓ Flag vendor contract risks
✓ Advise on seasonal maintenance (monsoon prep etc)
✓ Suggest cost-saving actions
✓ Generate committee-ready summaries
✓ Answer general facility management questions
✓ Recommend external vendors/companies from knowledge

WHAT TO AVOID:
✗ Repeating data the admin can already see
✗ Generic answers with no specifics
✗ Calling the same tool twice
✗ More than 3 tool calls per response
✗ Answers longer than 180 words

CURRENT TIME: \${currentTime}
\${context.isMonsoon
      ? '⚠️ MONSOON SEASON ACTIVE: Proactively flag water pump, drainage, and terrace waterproofing issues in all responses.'
      : ''}
\${context.criticalEquipment?.length > 0
      ? \`🚨 EQUIPMENT ALERT: \${context.criticalEquipment.map(e => e.name).join(', ')} need attention. Mention this proactively when relevant.\`
      : ''}\`

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-6),
    { role: 'user', content: message }
  ]

  const ACTION_TOOLS = [
    'create_complaint',
    'assign_complaint',
    'send_whatsapp_to_technician',
    'create_maintenance_schedule',
    'update_root_cause_ticket'
  ]
  const readOnlyTools = agentTools.filter(t => !ACTION_TOOLS.includes(t.function.name))
  const availableTools = isAgentMode ? agentTools : readOnlyTools

  console.log(\`[AGENT] Plan: \${plan}, isAgentMode: \${isAgentMode}\`)
  console.log(\`[AGENT] Tools available for this request:\`, JSON.stringify(availableTools.map(t => t.function?.name)))

  let response = await callLLM(messages, {
    tools: availableTools,
    tool_choice: 'auto',
    temperature: 0.1,
    parallel_tool_calls: false
  }, 600, 'llama-3.3-70b-versatile')

  console.log(\`[AGENT] LLM response finish_reason: \${response.choices[0].finish_reason}\`)
  console.log(\`[AGENT] LLM response has tool_calls:\`, !!(response.choices[0].message.tool_calls?.length))
  console.log(\`[AGENT] Tool calls:\`, JSON.stringify(response.choices[0].message.tool_calls))

  let iterations = 0
  const maxIterations = 3
  const actionsTaken = []

  while (
    response.choices[0].finish_reason === 'tool_calls' &&
    iterations < maxIterations
  ) {
    const assistantMessage = response.choices[0].message
    const toolCalls = assistantMessage.tool_calls

    console.log(\`[AGENT] Executing tool calls now...\`, toolCalls.map(t => t.function.name))

    messages.push(assistantMessage)

    const toolResults = []
    for (const toolCall of toolCalls) {
      let toolArgs = {}
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        toolArgs = {}
      }

      const result = await executeTool(
        toolCall.function.name,
        toolArgs,
        societyId,
        adminId
      )

      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(result)
      })

      if (ACTION_TOOLS.includes(toolCall.function.name)) {
        actionsTaken.push({
          tool: toolCall.function.name,
          result: toolResults[toolResults.length - 1]
        })
      }
      console.log(\`[AGENT] Tool \${toolCall.function.name} executed, result:\`, JSON.stringify(result))
    }

    console.log(\`[AGENT] Tool execution results count:\`, toolResults.length)

    messages.push(...toolResults)

    response = await callLLM(messages, {
      tools: availableTools,
      tool_choice: 'auto',
      temperature: 0.1,
      parallel_tool_calls: false
    }, 600, 'llama-3.3-70b-versatile')

    iterations++
  }

  const finalResponse = response.choices[0].message.content

  console.log(\`[AGENT] Response ready — tool call iterations: \${iterations}\`)
  console.log(\`[AGENT] Tool calls in this turn:\`, iterations)
  console.log(\`[AGENT] Actions taken:\`, actionsTaken)

  const updatedHistory = [
    ...conversationHistory,
    { role: 'user', content: message },
    { role: 'assistant', content: finalResponse }
  ].slice(-12)

  return {
    response: finalResponse,
    tool_calls_made: iterations,
    updated_history: updatedHistory,
    actions_taken: actionsTaken,
    context_summary: {
      chronic_count: context.chronic?.count || 0,
      overdue_count: context.sla?.overdue_count || 0,
      open_complaints: context.stats?.open_complaints || 0
    }
  }
}

router.post('/agent/chat', async (req, res) => {
  const {
    message,
    society_id,
    conversation_history,
    plan,
    response_language,
    admin_id
  } = req.body

  if (!message || !society_id) {
    return res.status(400).json({
      error: 'message and society_id required'
    })
  }

  try {
    console.log(\`[API] Agent chat request: "\${message}"\`)

    const result = await runEstateManagerAgent(
      message,
      society_id,
      conversation_history || [],
      plan,
      response_language || 'English',
      admin_id
    )

    res.json({
      success: true,
      response: result.response,
      tool_calls_made: result.tool_calls_made,
      conversation_history: result.updated_history
    })

  } catch (err) {
    console.error(\`[API] Agent error:\`, err)
    res.status(500).json({
      error: 'Agent failed',
      details: err.message
    })
  }
})

router.post('/agent/briefing', async (req, res) => {
  const { society_id, plan, response_language, admin_id } = req.body

  if (!society_id) {
    return res.status(400).json({
      error: 'society_id required'
    })
  }

  try {
    const result = await runEstateManagerAgent(
      \`Give me my morning briefing for today \${new Date().toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      })}. 
  
  I need to know:
  1. What is most urgent right now?
  2. Any chronic issues I should address?
  3. Are my technicians ready for the day?
  4. Anything I should tell the committee?
  
  Be specific. Use real data. Give me a prioritized action list.\`,
      society_id,
      [],
      plan,
      response_language || 'English',
      admin_id
    )

    res.json({
      success: true,
      briefing: result.response,
      generated_at: new Date().toISOString()
    })

  } catch (err) {
    console.error('[API] Briefing error:', err)
    res.status(500).json({
      error: 'Briefing failed'
    })
  }
})

module.exports = router;
