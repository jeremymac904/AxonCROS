import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AxonSettings, settingsDestinations } from '../src/components/AxonSettings';
function Fixture() {
  const [section, setSection] = useState('general');
  return <><nav aria-label="Test settings navigation">{settingsDestinations.map(([id, label]) => <button key={id} onClick={() => setSection(id)}>{label}</button>)}</nav><AxonSettings section={section} onNavigate={route => setSection(route.split('/').at(-1) || 'general')} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
