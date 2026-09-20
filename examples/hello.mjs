import { runGuide } from '@zevaier/config-guides';

const controller = new AbortController();
const onInterrupt = () => controller.abort();
process.once('SIGINT', onInterrupt);
try {
  const result = await runGuide({
    specFile: new URL('./hello-world.json', import.meta.url),
    signal: controller.signal,
    // These are configuration instructions only, not a connection test.
  });
  console.log(result);
} finally { process.off('SIGINT', onInterrupt); }
