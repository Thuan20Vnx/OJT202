import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider, ToastProvider } from './lib/app.jsx';
import { installRipple } from './lib/ripple.js';
import '@fontsource-variable/inter';
import '@fontsource/material-symbols-outlined/400.css';
import './index.css';

installRipple();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
