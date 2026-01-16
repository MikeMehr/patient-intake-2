"use client";

import { useState, useEffect } from "react";
import Logo from "./Logo";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setIsMobileMenuOpen(false);
    }
  };

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 shadow-lg"
      style={{ backgroundColor: "rgb(18, 39, 192)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[165px]">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <Logo size="small" />
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <button
              onClick={() => scrollToSection("features")}
              className="text-white hover:text-cyan-300 transition-colors font-medium"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("benefits")}
              className="text-white hover:text-cyan-300 transition-colors font-medium"
            >
              Benefits
            </button>
            <button
              onClick={() => scrollToSection("hipaa")}
              className="text-white hover:text-cyan-300 transition-colors font-medium"
            >
              HIPAA Compliance
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="text-white hover:text-cyan-300 transition-colors font-medium"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection("faq")}
              className="text-white hover:text-cyan-300 transition-colors font-medium"
            >
              FAQ
            </button>
            <button
              onClick={() => scrollToSection("cta")}
              className="bg-gradient-to-r from-cyan-500 to-teal-500 text-white px-6 py-2 rounded-full hover:shadow-lg transition-all font-semibold"
            >
              Get Started
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-white hover:text-cyan-300 p-2"
              aria-label="Toggle menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isMobileMenuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden pb-4 space-y-3">
            <button
              onClick={() => scrollToSection("features")}
              className="block w-full text-left text-white hover:text-cyan-300 py-2 font-medium"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("benefits")}
              className="block w-full text-left text-white hover:text-cyan-300 py-2 font-medium"
            >
              Benefits
            </button>
            <button
              onClick={() => scrollToSection("hipaa")}
              className="block w-full text-left text-white hover:text-cyan-300 py-2 font-medium"
            >
              HIPAA Compliance
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="block w-full text-left text-white hover:text-cyan-300 py-2 font-medium"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection("faq")}
              className="block w-full text-left text-white hover:text-cyan-300 py-2 font-medium"
            >
              FAQ
            </button>
            <button
              onClick={() => scrollToSection("cta")}
              className="block w-full bg-gradient-to-r from-cyan-500 to-teal-500 text-white px-6 py-2 rounded-full font-semibold text-center"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

