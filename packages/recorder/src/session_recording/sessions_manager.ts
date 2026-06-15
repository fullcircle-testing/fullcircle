import {
    FinishedSessionResult,
    RecordingSession,
    RecordingSessionStatus,
} from './session_recorder';

export type SessionManagerStatus = {
    recording: boolean;
    currentSession: RecordingSessionStatus | null;
    recentCalls: RecordingSessionStatus['recentCalls'];
    lastFinishedSession: FinishedSessionResult | null;
};

export class SessionManager {
    private currentSession?: RecordingSession;
    private lastFinishedSession: FinishedSessionResult | null = null;

    startNewSession = () => {
        this.currentSession = new RecordingSession();
    }

    getCurrentSession = (): RecordingSession | undefined => {
        return this.currentSession;
    }

    getStatus = (): SessionManagerStatus => {
        const currentSession = this.currentSession?.getStatus() ?? null;
        return {
            recording: Boolean(currentSession),
            currentSession,
            recentCalls: currentSession?.recentCalls ?? [],
            lastFinishedSession: this.lastFinishedSession,
        };
    }

    finishCurrentSessionDetails = async (sessionName: string): Promise<FinishedSessionResult | undefined> => {
        const session = this.currentSession;
        if (!session) {
            return undefined;
        }

        const result = await session.finish(sessionName);
        this.currentSession = undefined;
        this.lastFinishedSession = result;
        return result;
    }

    finishCurrentSession = async (sessionName: string): Promise<string | undefined> => {
        const result = await this.finishCurrentSessionDetails(sessionName);
        if (!result) {
            return undefined;
        }

        return result.message;
    }
}
