"use client";

import { useState } from "react";

export default function ImageCarousel() {
  // Image paths
  const images = [
    "/Landing1.png",
    "/Landing2.png",
    "/Landing3.png",
  ];

  // Duplicate images for seamless loop (2 sets for smooth infinite scroll)
  const duplicatedImages = [...images, ...images];
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  return (
    <div className="w-full mb-12 overflow-hidden pt-44">
      <div className="relative w-full overflow-hidden">
        {/* Swipe animation container - images appear centered and swipe out top to bottom */}
        <div className="relative flex items-center justify-center" style={{ height: "min(504px, 47.04vw)", width: "100%" }}>
          {images.map((src, index) => {
            const imageIndex = index;
            const isLoaded = loadedImages.has(src);
            const animationDelay = index * 8; // Each image starts 8s after the previous (exit finishes at 58.33% of 12s = ~7s, adding 1s buffer to ensure previous image fully exits before next enters)
            
            return (
              <div
                key={`${src}-${index}`}
                className="absolute overflow-hidden animate-swipe"
                style={{
                  width: "min(560px, 59.5vw)",
                  height: "min(504px, 47.04vw)",
                  left: "50%",
                  top: "50%",
                  animationDelay: `${animationDelay}s`,
                  margin: 0,
                  padding: 0,
                  perspective: "1000px",
                  transformStyle: "preserve-3d",
                }}
              >
                <img
                  src={src}
                  alt={`Application screenshot ${imageIndex + 1}`}
                  className="w-full h-full"
                  onLoad={() => {
                    setLoadedImages((prev) => new Set(prev).add(src));
                  }}
                  onError={(e) => {
                    // Hide broken images
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                  }}
                  style={{
                    display: "block",
                    objectFit: "cover",
                    width: "100%",
                    height: "100%",
                    margin: 0,
                    padding: 0,
                  }}
                />
              </div>
            );
          })}
        </div>
        
        {/* Show message if no images loaded */}
        {loadedImages.size === 0 && (
          <div className="text-white/60 text-sm text-center py-8">
            <p>Loading application screenshots...</p>
          </div>
        )}
      </div>
    </div>
  );
}

