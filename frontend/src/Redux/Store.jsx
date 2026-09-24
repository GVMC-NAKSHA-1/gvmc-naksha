import { combineReducers, configureStore } from '@reduxjs/toolkit';
import wards from './slices/wardsSlice';
import properties from './slices/propertiesSlice';
import stats from './slices/statsSlice';
import admin from './slices/adminSlice';
import chat from './slices/chatSlice';
import alerts from './slices/alertsSlice';
import assessments from './slices/assessmentsSlice';
import tickets from './slices/ticketsSlice';
import sources from './slices/sourcesSlice';
import harmonization from './slices/harmonizationSlice';
import conflicts from './slices/conflictsSlice';

export const rootReducer = combineReducers({
  wards, properties, stats, admin, chat, alerts, assessments, tickets, sources, harmonization, conflicts,
});

export function makeStore(preloadedState) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (gdm) => gdm({ serializableCheck: false }),
  });
}

const store = makeStore();
export default store;
