interface RecordButtonProps {
  isRecording: boolean;
  isBusy: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export function RecordButton({ isRecording, isBusy, disabled, onPress }: RecordButtonProps) {
  const label = isBusy ? "Transcribing…" : isRecording ? "Stop" : "Record";
  const variant = isRecording ? "danger" : "accent";

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled || isBusy}
      className={[
        "min-h-14 min-w-[10rem] rounded-xl px-8 py-4 text-base font-semibold tracking-wide transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "accent" && "bg-accent text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent-muted",
        variant === "danger" && "bg-danger text-danger-foreground shadow-lg shadow-danger/25 hover:brightness-110",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </button>
  );
}
