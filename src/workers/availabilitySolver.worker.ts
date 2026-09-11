import { solveAvailability, type FeasibilityInput } from '../utils/availabilitySolver';

self.onmessage = (event: MessageEvent<FeasibilityInput>) => {
  try { self.postMessage(solveAvailability(event.data)); }
  catch { self.postMessage({ status: 'invalid', reason: 'The schedule check could not finish. No approval was saved.' }); }
};
