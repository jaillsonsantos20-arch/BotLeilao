interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 48, className }: LogoProps) {
  return (
    <img
      src="/logo-lancezap.svg"
      alt="LanceZap"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
