import { getUpcomingEvents } from "./calendar.js";

const events = await getUpcomingEvents();

console.log(events);