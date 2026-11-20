import { useCallback, useEffect, useRef, useState } from 'react';

export function useVoiceBriefing() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPlayingKey(null);
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const speak = useCallback(
    async (key: string, text: string, style?: string) => {
      if (playingKey === key) {
        stop();
        return;
      }
      stop();
      setVoiceError(null);
      setLoadingKey(key);

      try {
        const res = await fetch('/api/dispatcher/voice-briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, style }),
        });
        const data = await res.json();
        if (!res.ok || !data.audioBase64) {
          throw new Error(data.error || 'Voice briefing audio unavailable.');
        }

        const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
        audioRef.current = audio;
        audio.onended = () => {
          setPlayingKey(null);
          audioRef.current = null;
        };
        audio.onerror = () => {
          setPlayingKey(null);
          setVoiceError('Unable to play synthesized audio.');
          audioRef.current = null;
        };
        setPlayingKey(key);
        await audio.play();
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Failed to generate voice briefing.');
        setPlayingKey(null);
      } finally {
        setLoadingKey(null);
      }
    },
    [playingKey, stop]
  );

  return {
    playingKey,
    loadingKey,
    voiceError,
    speak,
    stop,
  };
}
