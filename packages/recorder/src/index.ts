import {initApp} from './express_app';
import {SessionManager} from './session_recording.ts/sessions_manager';

const defaultDestination = process.env.DESTINATION;
const useDestinationHostHeader = process.env.USE_DESTINATION_HOST_HEADER;

if (!defaultDestination && useDestinationHostHeader !== 'true') {
    console.log('Please provide a destination via the DESTINATION enviornment variable, or bypass this check by setting the USE_DESTINATION_HOST_HEADER bool environment variable');
}

const sessionManager = new SessionManager();
const app = initApp({sessionManager, defaultDestination});

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
