import {initApp} from './express_app';
import {SessionManager} from './session_recording/sessions_manager';
import {initTerminal} from './terminal_interaction';
import {AppDependencies} from './types';

const defaultDestination = process.env.DESTINATION;
const useDestinationHostHeader = process.env.USE_DESTINATION_HOST_HEADER;

if (!defaultDestination && useDestinationHostHeader !== 'true') {
    console.log('Please provide a destination via the DESTINATION enviornment variable, or bypass this check by setting the USE_DESTINATION_HOST_HEADER bool environment variable');
}

const includeHeaders = false;

const sessionManager = new SessionManager();
const deps: AppDependencies = {
    sessionManager,
    defaultDestination,
    includeHeaders,
};

initTerminal(deps);
const app = initApp(deps);

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
