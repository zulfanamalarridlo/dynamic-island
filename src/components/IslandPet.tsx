import { useState } from 'react';
import type { PetStyle } from '../lib/appearanceSettings';

type PetMood = 'normal' | 'bored' | 'hungry' | 'sleepy';

interface IslandPetProps {
  style: PetStyle;
  customImage?: string;
  isPlaying: boolean;
  isCharging: boolean;
  pcIdleSeconds: number;
  idleThresholdMinutes: number;
}

export default function IslandPet({
  style,
  customImage,
  isPlaying,
  isCharging,
  pcIdleSeconds,
  idleThresholdMinutes
}: IslandPetProps) {
  const [happy, setHappy] = useState(false);

  if (style === 'none') return null;

  const triggerHappy = (event: React.MouseEvent) => {
    event.stopPropagation();
    setHappy(true);
    window.setTimeout(() => setHappy(false), 1200);
  };

  const thresholdSeconds = Math.max(1, Math.min(60, idleThresholdMinutes || 10)) * 60;
  let idleMood: PetMood = 'normal';
  if (!isPlaying && !happy && pcIdleSeconds >= thresholdSeconds) {
    const phase = Math.floor((pcIdleSeconds - thresholdSeconds) / 45) % 3;
    idleMood = phase === 0 ? 'bored' : phase === 1 ? 'hungry' : 'sleepy';
  }

  const resolvedStyle: Exclude<PetStyle, 'none'> =
    style === 'custom' && customImage
      ? 'custom'
      : style === 'ghost' || style === 'bot'
        ? style
        : 'luffy';
  const title = resolvedStyle === 'luffy'
    ? (isPlaying
      ? 'Luffy vibing!'
      : idleMood === 'bored'
        ? 'Luffy bosan... (PC idle)'
        : idleMood === 'hungry'
          ? 'Nikuuu! Luffy lapar!'
          : idleMood === 'sleepy'
            ? 'Zzz... Luffy mengantuk'
            : isCharging
              ? 'Gear 2 charging!'
              : 'Shishishi!')
    : (isPlaying ? 'Vibing' : isCharging ? 'Charging' : 'Pet me');

  return (
    <button
      type="button"
      className={`island-pet island-pet--${resolvedStyle} island-pet--${idleMood}${isPlaying ? ' is-dancing' : ''}${isCharging ? ' is-charging' : ''}${happy ? ' is-happy' : ''}`}
      onClick={triggerHappy}
      aria-label={resolvedStyle === 'luffy' ? 'Luffy companion' : 'Island companion'}
      title={title}
    >
      {resolvedStyle === 'custom' && customImage && (
        <span className="island-pet__stage">
          <img className="island-pet__custom-img" src={customImage} alt="Custom pet" />
          {idleMood === 'bored' && (
            <span className="island-pet__thought island-pet__thought--bored" aria-hidden="true">…</span>
          )}
          {idleMood === 'hungry' && (
            <span className="island-pet__thought island-pet__thought--meat" aria-hidden="true">🍖</span>
          )}
          {idleMood === 'sleepy' && (
            <span className="island-pet__thought island-pet__thought--zzz" aria-hidden="true">z</span>
          )}
        </span>
      )}
      {resolvedStyle === 'luffy' && (
        <span className="island-pet__stage">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            {/* Iconic Straw Hat Brim */}
            <ellipse cx="16" cy="11.5" rx="14" ry="3.8" fill="#facc15" stroke="#a16207" strokeWidth="1" />
            {/* Straw Hat Dome */}
            <path d="M7.5 11C7.8 5.8 11.4 3.5 16 3.5C20.6 3.5 24.2 5.8 24.5 11Z" fill="#fde047" stroke="#a16207" strokeWidth="1" />
            {/* Red Hat Band */}
            <path d="M7.7 9.6C10.5 10.6 21.5 10.6 24.3 9.6L24.5 11.4C21.5 12.4 10.5 12.4 7.5 11.4Z" fill="#dc2626" />
            {/* Chibi Face */}
            <circle cx="16" cy="18.2" r="7.4" fill="#fed7aa" stroke="#7c2d12" strokeWidth="0.9" />
            {/* Spiky Black Hair */}
            <path d="M8.6 15.8C8.8 12.2 11.8 11.4 16 11.4C20.2 11.4 23.2 12.2 23.4 15.8L21.5 13.8L19.8 15.5L17.4 13.4L15.6 15.4L13.5 13.5L11.2 15.4Z" fill="#18181b" />
            {/* Eyes */}
            {idleMood === 'sleepy' ? (
              <>
                <path d="M11.8 18.4Q13.2 19.4 14.5 18.4" stroke="#111827" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                <path d="M17.5 18.4Q18.8 19.4 20.2 18.4" stroke="#111827" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </>
            ) : idleMood === 'bored' ? (
              <>
                <line x1="11.6" y1="17.6" x2="14.6" y2="17.6" stroke="#111827" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="13.2" cy="18.5" r="0.9" fill="#111827" />
                <line x1="17.4" y1="17.6" x2="20.4" y2="17.6" stroke="#111827" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="18.8" cy="18.5" r="0.9" fill="#111827" />
              </>
            ) : (
              <>
                <circle className="island-pet__eye" cx="13.2" cy="18.2" r={idleMood === 'hungry' ? '1.45' : '1.2'} fill="#111827" />
                <circle className="island-pet__eye" cx="18.8" cy="18.2" r={idleMood === 'hungry' ? '1.45' : '1.2'} fill="#111827" />
                {idleMood === 'hungry' && (
                  <>
                    <circle cx="13.6" cy="17.8" r="0.45" fill="#fef08a" />
                    <circle cx="19.2" cy="17.8" r="0.45" fill="#fef08a" />
                  </>
                )}
              </>
            )}
            {/* Under-eye Scar */}
            <path d="M18.2 20.5L20.4 20.1" stroke="#991b1b" strokeWidth="0.9" strokeLinecap="round" />
            <path d="M19.3 19.7V20.9" stroke="#991b1b" strokeWidth="0.7" strokeLinecap="round" />
            {/* Mouth */}
            {idleMood === 'sleepy' ? (
              <>
                <circle cx="16" cy="22.1" r="1.2" fill="#9a3412" />
                <circle className="island-pet__bubble" cx="18.2" cy="21.4" r="1.8" fill="rgba(186, 230, 253, 0.72)" stroke="#e0f2fe" strokeWidth="0.5" />
              </>
            ) : idleMood === 'bored' ? (
              <path d="M13.6 22.1Q16 21.3 18.4 22.1" stroke="#7c2d12" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            ) : idleMood === 'hungry' ? (
              <>
                <path d="M12.6 21.1C14.1 24.2 17.9 24.2 19.4 21.1Z" fill="#ef4444" stroke="#7c2d12" strokeWidth="0.8" />
                <path className="island-pet__drool" d="M18.1 22.8C18.7 24.1 18.7 25.3 18.1 25.5C17.5 25.3 17.5 24.1 18.1 22.8Z" fill="#93c5fd" />
              </>
            ) : (
              <path d="M12.6 21.2C14.2 23.6 17.8 23.6 19.4 21.2Z" fill="#ffffff" stroke="#7c2d12" strokeWidth="0.8" strokeLinejoin="round" />
            )}
            {/* Red Vest Collar Hint */}
            <path d="M11.8 25.4L16 28.2L20.2 25.4" fill="none" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {idleMood === 'bored' && (
            <span className="island-pet__thought island-pet__thought--bored" aria-hidden="true">…</span>
          )}
          {idleMood === 'hungry' && (
            <span className="island-pet__thought island-pet__thought--meat" aria-hidden="true">🍖</span>
          )}
          {idleMood === 'sleepy' && (
            <span className="island-pet__thought island-pet__thought--zzz" aria-hidden="true">z</span>
          )}
        </span>
      )}
      {resolvedStyle === 'ghost' && (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 12C6 7.8 8.7 5 12 5C15.3 5 18 7.8 18 12V19L15.6 17.3L13.2 19L12 17.6L10.8 19L8.4 17.3L6 19V12Z" fill="currentColor" opacity="0.92" />
          <circle className="island-pet__eye" cx="9.6" cy="11.5" r="1.25" fill="#0d1117" />
          <circle className="island-pet__eye" cx="14.4" cy="11.5" r="1.25" fill="#0d1117" />
        </svg>
      )}
      {resolvedStyle === 'bot' && (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <line x1="12" y1="4" x2="12" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="3.5" r="1.3" fill="currentColor" />
          <rect x="4.5" y="7" width="15" height="12" rx="4" fill="currentColor" opacity="0.92" />
          <rect x="7" y="10.2" width="10" height="4.8" rx="2" fill="#0d1117" />
          <circle className="island-pet__eye" cx="9.8" cy="12.6" r="1.15" fill="#7dd3fc" />
          <circle className="island-pet__eye" cx="14.2" cy="12.6" r="1.15" fill="#7dd3fc" />
        </svg>
      )}
    </button>
  );
}
