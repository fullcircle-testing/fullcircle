import {RecordingSession} from './session_recorder';

export class SessionManager {
    private currentSession?: RecordingSession;

    startNewSession = () => {
        this.currentSession = new RecordingSession();
    }

    getCurrentSession = (): RecordingSession | undefined => {
        return this.currentSession;
    }
}
