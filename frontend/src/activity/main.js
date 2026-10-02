import React from 'react';
import ReactDOM from 'react-dom/client';
import './activity.css';
import ActivityApp from './ActivityApp.js';

// The OmniFM Activity (#308): its own small page, none of the website's code,
// no service worker, no cookie banner. Discord shows it in the voice channel.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ActivityApp />
  </React.StrictMode>
);
