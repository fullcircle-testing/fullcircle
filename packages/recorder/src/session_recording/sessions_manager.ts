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
        const session = this.currentSession;
        if (!session) {
            return undefined;
        }

        const result = await session.logRecordedCalls(sessionName);
        this.currentSession = undefined;
        return result;
    }
}
