import {initApp} from './express_app';
import {SessionManager} from './session_recording.ts/sessions_manager';

const sessionManager = new SessionManager();
const app = initApp({sessionManager, shouldProxy: true});

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});
