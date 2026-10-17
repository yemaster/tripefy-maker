import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import App from './App';
import './index.css';
import './editor.css';
flushSync(()=>createRoot(document.getElementById('root')).render(<App/>));
import('./editor/app.js');
