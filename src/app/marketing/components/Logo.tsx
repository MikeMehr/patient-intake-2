"use client";

import Image from "next/image";

export default function Logo({ 
  className,
  size = "default"
}: { 
  className?: string;
  size?: "small" | "default" | "large";
}) {
  const sizeMap = {
    small: { width: 240, height: 100 },
    default: { width: 320, height: 135 },
    large: { width: 480, height: 200 },
  };
  
  const { width, height } = sizeMap[size];
    
  return (
    <div className={`flex items-center ${className || ""}`}>
      <Image
        src="/logo.png"
        alt="Health Assist AI"
        width={width}
        height={height}
        priority
        className="object-contain"
      />
    </div>
  );
}

