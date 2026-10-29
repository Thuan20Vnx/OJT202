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

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử root của TaskFlow');

ReactDOM.createRoot(root).render(
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
