import { combineReducers, configureStore } from '@reduxjs/toolkit';
import wards from './slices/wardsSlice';
import sources from './slices/sourcesSlice';
import harmonization from './slices/harmonizationSlice';
import conflicts from './slices/conflictsSlice';
import harmonized from './slices/harmonizedSlice';
import properties from './slices/propertiesSlice';
import stats from './slices/statsSlice';
import admin from './slices/adminSlice';
import chat from './slices/chatSlice';
import jobs from './slices/jobsSlice';
import processing from './slices/processingSlice';
import quality from './slices/qualitySlice';

export const rootReducer = combineReducers({
  wards, sources, harmonization, conflicts, harmonized, properties, stats, admin, chat, jobs, processing, quality,
});

export function makeStore(preloadedState) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

const store = makeStore();
export default store;
