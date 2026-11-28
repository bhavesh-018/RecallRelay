interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  subtitle?: string;
}

const SIZE_MAP = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
};

export function BrandLogo({ size = 'sm', showWordmark = false, subtitle }: BrandLogoProps) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 36 36"
        fill="none"
        className={`${SIZE_MAP[size]} shrink-0`}
        aria-hidden="true"
      >
        <rect width="36" height="36" rx="9" fill="#0F1117" />
        <rect
          x="0.75"
          y="0.75"
          width="34.5"
          height="34.5"
          rx="8.25"
          stroke="#2E323C"
          strokeWidth="1.5"
        />
        <path
          d="M10.5 13.5C12.2 10.2 15.6 8.2 19.5 8.5C24.2 8.9 27.8 12.9 27.5 17.7"
          stroke="#3B82F6"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M25.5 22.5C23.8 25.8 20.4 27.8 16.5 27.5C11.8 27.1 8.2 23.1 8.5 18.3"
          stroke="#60A5FA"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M24.6 15.6L27.5 18.1L29.5 14.9"
          stroke="#3B82F6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11.4 20.4L8.5 17.9L6.5 21.1"
          stroke="#60A5FA"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="18" r="3.4" fill="#F4F4F5" />
        <circle cx="18" cy="18" r="1.4" fill="#3B82F6" />
      </svg>

      {showWordmark && (
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#F4F4F5]">
              RecallRelay
            </span>
          </div>
          {subtitle && (
            <span className="mt-0.5 text-xs font-normal rr-muted">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
