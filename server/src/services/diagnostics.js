const MAX_EVENTS = 200;
const events = [];
let sequence = 0;

export function recordEvent(level, scope, message, details) {
  const event = { id: ++sequence, timestamp: new Date().toISOString(), level, scope, message,
    ...(details === undefined ? {} : { details }) };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  output(`[TRANSCRIBER:${scope}]`, message, details ?? '');
  return event;
}

export function getEvents(after = 0) {
  return events.filter((event) => event.id > after);
}
