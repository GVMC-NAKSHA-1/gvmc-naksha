import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import store from './Redux/Store.jsx';
import App from './App.jsx';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import { MOCK_MODE } from './api/env';

async function enableMocking() {
  if (!MOCK_MODE) return;
  const { worker } = await import('./mocks/browser.js');
  await worker.start({ quiet: true, onUnhandledRequest: 'bypass', serviceWorker: { url: '/mockServiceWorker.js' } });
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>,
  );
});
