interface SlideDigitsProps {
  value: string;
  className?: string;
}

export default function SlideDigits({ value, className }: SlideDigitsProps) {
  return (
    <span className={`slide-digits${className ? ` ${className}` : ''}`} aria-label={value}>
      {value.split('').map((char, index) => {
        if (!/\d/.test(char)) {
          return (
            <span key={`sep-${index}`} className="slide-digits__sep" aria-hidden="true">
              {char}
            </span>
          );
        }
        return (
          <span key={`slot-${index}`} className="slide-digits__slot" aria-hidden="true">
            <span key={`${index}-${char}`} className="slide-digits__char">
              {char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
