import { createSlice, nanoid } from '@reduxjs/toolkit';

// Local-only for now (no backend endpoint yet). mapAPIToUI / mapUIToAPI are ready for
// POST /api/assessments and PATCH /api/assessments/{id}.
export const mapAPIToUI = (a) => ({
  id: a.id,
  propertyId: a.property_id,
  wardId: a.ward_id,
  officerId: a.officer_id,
  submittedAt: a.submitted_at,
  status: a.status,
  ownerName: a.owner_name,
  doorNumber: a.door_number,
  surveyNumber: a.survey_number,
  locality: a.locality,
  constructionType: a.construction_type,
  floors: a.floors,
  builtUpAreaSqm: a.built_up_area_sqm,
  newlyConstructedAreaSqm: a.newly_constructed_area_sqm,
  violationType: a.violation_type,
  remarks: a.remarks,
  estimatedTaxInr: a.estimated_tax_inr,
  estimatedPenaltyInr: a.estimated_penalty_inr,
  recommendedAction: a.recommended_action,
});

export const mapUIToAPI = (u) => ({
  property_id: u.propertyId,
  ward_id: u.wardId,
  owner_name: u.ownerName,
  door_number: u.doorNumber,
  survey_number: u.surveyNumber,
  locality: u.locality,
  construction_type: u.constructionType,
  floors: u.floors,
  built_up_area_sqm: u.builtUpAreaSqm,
  newly_constructed_area_sqm: u.newlyConstructedAreaSqm,
  violation_type: u.violationType,
  remarks: u.remarks,
  estimated_tax_inr: u.estimatedTaxInr,
  estimated_penalty_inr: u.estimatedPenaltyInr,
  recommended_action: u.recommendedAction,
});

let counter = 0;

const assessmentsSlice = createSlice({
  name: 'assessments',
  initialState: { items: [], lastSubmittedId: null },
  reducers: {
    submitAssessment: {
      reducer(state, action) {
        state.items.unshift(action.payload);
        state.lastSubmittedId = action.payload.id;
      },
      prepare(form) {
        counter += 1;
        return {
          payload: {
            ...form,
            id: `ASMT-${String(counter).padStart(4, '0')}`,
            key: nanoid(),
            officerId: 'OFF-1042',
            submittedAt: new Date().toISOString(),
            status: 'pending_review',
          },
        };
      },
    },
    updateAssessmentStatus(state, action) {
      const a = state.items.find((x) => x.id === action.payload.id);
      if (a) a.status = action.payload.status;
    },
    clearLastSubmitted(state) { state.lastSubmittedId = null; },
  },
});

export const { submitAssessment, updateAssessmentStatus, clearLastSubmitted } = assessmentsSlice.actions;

export const selectAssessments = (s) => s.assessments.items;
export const selectPendingAssessments = (s) => s.assessments.items.filter((a) => a.status === 'pending_review');
export const selectPendingAssessmentsCount = (s) => s.assessments.items.filter((a) => a.status === 'pending_review').length;
export const selectLastSubmittedId = (s) => s.assessments.lastSubmittedId;

export default assessmentsSlice.reducer;
