import {RecordingSession} from './session_recorder';

export class SessionManager {
    private currentSession?: RecordingSession;

    startNewSession = () => {
        this.currentSession = new RecordingSession();
    }

    getCurrentSession = (): RecordingSession | undefined => {
        return this.currentSession;
    }

    finishCurrentSession = async (sessionName: string): Promise<string | undefined> => {
        return this.currentSession?.logRecordedCalls(sessionName);
    }
}
