import { stRequest } from './client.js';
import { config } from '../config.js';
import { JobNoteRequest, AppointmentRequest, CreateJobRequest } from '../schemas/mutations.js';

export async function addJobNote(jobId: string, req: JobNoteRequest, idempotencyKey: string): Promise<any> {
  const path = `/jpm/v2/tenant/${config.ST_TENANT_ID}/jobs/${jobId}/notes`;
  const payload = {
    text: req.text,
    pinToTop: req.pinToTop
  };
  return stRequest('POST', path, payload);
}

export async function addAppointment(req: AppointmentRequest, idempotencyKey: string): Promise<any> {
  const path = `/jpm/v2/tenant/${config.ST_TENANT_ID}/appointments`;
  return stRequest('POST', path, req);
}

export async function createJob(req: CreateJobRequest, idempotencyKey: string): Promise<any> {
  const path = `/jpm/v2/tenant/${config.ST_TENANT_ID}/jobs`;
  
  const payload: any = {
    customerId: req.customerId,
    locationId: req.locationId,
    businessUnitId: req.businessUnitId,
    jobTypeId: req.jobTypeId,
    priority: req.priority,
    summary: req.summary
  };

  if (req.campaignId !== undefined) {
    payload.campaignId = req.campaignId;
  }

  // Appointments: prefer the caller's native `appointments` array (ServiceTitan's
  // own shape) and pass it straight through. Otherwise build a one-entry array
  // from scheduledWindow / assignedTechnicianIds (bridge convenience shape).
  // ServiceTitan requires at least one appointment window on job create; a job
  // sent with neither is rejected upstream, and the surfaced error now says why.
  if (req.appointments && req.appointments.length > 0) {
    payload.appointments = req.appointments;
  } else if (req.scheduledWindow || req.assignedTechnicianIds) {
    const appt: any = {
      start: req.scheduledWindow?.start,
      end: req.scheduledWindow?.end,
      arrivalWindowStart: req.scheduledWindow?.arrivalWindowStart,
      arrivalWindowEnd: req.scheduledWindow?.arrivalWindowEnd,
    };
    if (req.assignedTechnicianIds && req.assignedTechnicianIds.length > 0) {
      appt.technicianIds = req.assignedTechnicianIds;
    }
    payload.appointments = [appt];
  }

  const jobResult = await stRequest('POST', path, payload);
  
  if (req.initialNotes && req.initialNotes.length > 0) {
    let allNotesSucceeded = true;
    for (const note of req.initialNotes) {
      try {
        await addJobNote(String(jobResult.id), { text: note }, `${idempotencyKey}-note-${Date.now()}`);
      } catch (e) {
        allNotesSucceeded = false;
      }
    }
    jobResult.status = allNotesSucceeded ? 'complete' : 'partial';
  }

  return jobResult;
}
