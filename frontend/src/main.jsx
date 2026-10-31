
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Global Styling
import './index.css';

// Neumorphism Theme
import './neumorphism.css';

// Mobile Responsive Styling
import './mobile.css';

// Final mobile readability and navigation overrides
import './ui-polish.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
