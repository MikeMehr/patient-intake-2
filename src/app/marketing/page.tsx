"use client";

import React, { useEffect, useRef, useState } from "react";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Pricing from "./components/Pricing";
import Testimonials from "./components/Testimonials";
import ImageCarousel from "./components/ImageCarousel";

export default function MarketingPage() {
  const sectionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    // Intersection Observer for fade-in animations
    const observerOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("animate-fade-in");
        }
      });
    }, observerOptions);

    // Observe all sections
    Object.values(sectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      Object.values(sectionRefs.current).forEach((ref) => {
        if (ref) observer.unobserve(ref);
      });
    };
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero Section */}
      <section
        id="hero"
        className="relative min-h-screen flex items-center justify-center overflow-hidden"
        style={{
          backgroundColor: "rgb(18, 39, 192)"
        }}
      >
        {/* Animated background elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-cyan-300 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-400 rounded-full blur-3xl animate-pulse delay-1000"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Image Carousel */}
          <div className="mb-12">
            <ImageCarousel />
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            Made by Physicians,
            <br />
            <span className="text-red-400">for Physicians</span>
          </h1>
          <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-3xl mx-auto">
            Significantly reduce your workload and increase productivity with our
            HIPAA-compliant AI-powered patient intake solution. Designed from
            bottom to top for patient confidentiality.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => scrollToSection("cta")}
              className="bg-white text-cyan-600 px-8 py-4 rounded-full text-lg font-semibold hover:shadow-2xl hover:scale-105 transition-all"
            >
              Get Started Free
            </button>
            <button
              onClick={() => scrollToSection("features")}
              className="bg-white/20 backdrop-blur-md text-white border-2 border-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-white/30 transition-all"
            >
              Learn More
            </button>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </section>

      {/* Features Section */}
      <section
        id="features"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["features"] = el; }}
        className="py-20 bg-white opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Powerful Features for Modern Practices
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to streamline patient intake and reduce
              administrative burden
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: "🤖",
                title: "AI-Powered Intake",
                description:
                  "Intelligent conversation-based patient history collection that feels natural and comprehensive.",
              },
              {
                icon: "⚡",
                title: "Automated History",
                description:
                  "Save hours with automated history taking that captures detailed patient information accurately.",
              },
              {
                icon: "⚙️",
                title: "Customizable Workflows",
                description:
                  "Tailor the platform to match your clinic's specific needs and preferences.",
              },
              {
                icon: "📝",
                title: "Real-Time Documentation",
                description:
                  "Get instant, structured documentation ready for your EHR system.",
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="bg-gradient-to-br from-gray-50 to-white p-8 rounded-xl shadow-md hover:shadow-xl transition-all hover:-translate-y-2"
              >
                <div className="text-5xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section
        id="benefits"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["benefits"] = el; }}
        className="py-20 bg-gradient-to-br from-cyan-50 to-teal-50 opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Transform Your Practice
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Experience measurable improvements in productivity and patient care
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              {
                stat: "40%",
                label: "Reduction in Administrative Time",
                description:
                  "Spend less time on paperwork and more time with patients",
              },
              {
                stat: "3x",
                label: "Faster Patient Intake",
                description:
                  "Complete comprehensive patient histories in a fraction of the time",
              },
              {
                stat: "100%",
                label: "HIPAA Compliant",
                description:
                  "Built from the ground up with patient confidentiality as the foundation",
              },
            ].map((benefit, index) => (
              <div key={index} className="text-center">
                <div className="text-6xl font-bold text-cyan-600 mb-4">
                  {benefit.stat}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {benefit.label}
                </h3>
                <p className="text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                Increased Productivity
              </h3>
              <p className="text-gray-600 mb-4">
                Our platform helps physicians see more patients while maintaining
                the highest quality of care. Automated workflows eliminate
                repetitive tasks and reduce cognitive load.
              </p>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Streamlined patient intake process</span>
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Reduced documentation time</span>
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Better work-life balance</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-lg">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                Better Patient Care
              </h3>
              <p className="text-gray-600 mb-4">
                With comprehensive patient histories prepared in advance, you can
                focus on what matters most - understanding your patients and
                providing excellent care.
              </p>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>More time for patient interaction</span>
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Comprehensive patient histories</span>
                </li>
                <li className="flex items-start">
                  <svg
                    className="w-6 h-6 text-cyan-500 mr-2 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Reduced errors and omissions</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* HIPAA Compliance Section */}
      <section
        id="hipaa"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["hipaa"] = el; }}
        className="py-20 bg-white opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-red-50 to-cyan-50 rounded-2xl p-12 shadow-xl">
            <div className="text-center mb-12">
              <div className="inline-block bg-red-100 p-4 rounded-full mb-6">
                <svg
                  className="w-16 h-16 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                HIPAA Compliant by Design
              </h2>
              <p className="text-xl text-gray-700 max-w-3xl mx-auto">
                Built from the bottom up with patient confidentiality and data
                security as our foundation. Every feature is designed with HIPAA
                compliance in mind.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title: "End-to-End Encryption",
                  description:
                    "All patient data is encrypted in transit and at rest using industry-standard encryption protocols.",
                },
                {
                  title: "Access Controls",
                  description:
                    "Role-based access controls ensure only authorized personnel can access patient information.",
                },
                {
                  title: "Audit Logging",
                  description:
                    "Comprehensive audit trails track all access and modifications to patient data for compliance.",
                },
                {
                  title: "Business Associate Agreements",
                  description:
                    "We sign BAAs with all healthcare providers to ensure legal compliance.",
                },
                {
                  title: "Regular Security Audits",
                  description:
                    "Continuous security monitoring and regular third-party audits ensure ongoing compliance.",
                },
                {
                  title: "Patient Privacy First",
                  description:
                    "Patient confidentiality is not an afterthought - it's built into every aspect of our platform.",
                },
              ].map((feature, index) => (
                <div
                  key={index}
                  className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow"
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 text-center">
              <p className="text-lg text-gray-700 mb-4">
                <strong>Designed from bottom to top</strong> to be compliant with
                patient confidentiality regulations.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <span className="bg-white px-4 py-2 rounded-full text-sm font-semibold text-gray-700 shadow-md">
                  HIPAA Compliant
                </span>
                <span className="bg-white px-4 py-2 rounded-full text-sm font-semibold text-gray-700 shadow-md">
                  PIPEDA Compliant
                </span>
                <span className="bg-white px-4 py-2 rounded-full text-sm font-semibold text-gray-700 shadow-md">
                  SOC 2 Certified
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Flexibility & Customization Section */}
      <section
        id="customization"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["customization"] = el; }}
        className="py-20 bg-gray-50 opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Flexible & Customizable
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Adapt the platform to match your clinic's unique workflow and
              requirements
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-6">
                Tailored to Your Needs
              </h3>
              <p className="text-gray-600 mb-6">
                Every clinic is different, and so are your needs. Health Assist
                AI is highly flexible and customizable, allowing you to configure
                the platform to match your specific requirements.
              </p>
              <ul className="space-y-4">
                {[
                  "Custom intake questionnaires",
                  "Workflow customization",
                  "Branding and white-label options",
                  "Integration with your EHR system",
                  "Custom reporting and analytics",
                  "Specialty-specific configurations",
                ].map((item, index) => (
                  <li key={index} className="flex items-start">
                    <svg
                      className="w-6 h-6 text-cyan-500 mr-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-lg">
              <div className="space-y-6">
                {[
                  {
                    title: "Custom Workflows",
                    description:
                      "Design intake flows that match your clinic's process exactly.",
                  },
                  {
                    title: "Flexible Integration",
                    description:
                      "Seamlessly integrate with your existing systems and tools.",
                  },
                  {
                    title: "Scalable Solution",
                    description:
                      "Grows with your practice, from solo physician to large clinic.",
                  },
                ].map((feature, index) => (
                  <div key={index} className="border-l-4 border-cyan-500 pl-4">
                    <h4 className="font-semibold text-gray-900 mb-1">
                      {feature.title}
                    </h4>
                    <p className="text-gray-600">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <Testimonials />

      {/* Pricing */}
      <Pricing />

      {/* FAQ Section */}
      <section
        id="faq"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["faq"] = el; }}
        className="py-20 bg-white opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-600">
              Everything you need to know about Health Assist AI
            </p>
          </div>

          <FAQAccordion />
        </div>
      </section>

      {/* CTA Section */}
      <section
        id="cta"
        ref={(el: HTMLDivElement | null) => { sectionRefs.current["cta"] = el; }}
        className="py-20 bg-gradient-to-br from-cyan-500 to-teal-600 opacity-0 transition-opacity duration-1000"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to Transform Your Practice?
          </h2>
          <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
            Join physicians across Canada who are reducing workload and
            increasing productivity with Health Assist AI.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button className="bg-white text-cyan-600 px-8 py-4 rounded-full text-lg font-semibold hover:shadow-2xl hover:scale-105 transition-all">
              Start Free Trial
            </button>
            <button className="bg-white/20 backdrop-blur-md text-white border-2 border-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-white/30 transition-all">
              Schedule a Demo
            </button>
            <button className="bg-white/20 backdrop-blur-md text-white border-2 border-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-white/30 transition-all">
              Contact Sales
            </button>
          </div>
          <p className="text-white/80 text-sm">
            No credit card required • 14-day free trial • Cancel anytime
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}

// FAQ Accordion Component
function FAQAccordion() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);

  const faqs = [
    {
      question: "Is Health Assist AI really HIPAA compliant?",
      answer:
        "Yes, absolutely. Health Assist AI was designed from the bottom up with HIPAA compliance as a core requirement. We use end-to-end encryption, implement strict access controls, maintain comprehensive audit logs, and sign Business Associate Agreements (BAAs) with all healthcare providers. We also undergo regular security audits to ensure ongoing compliance.",
    },
    {
      question: "How customizable is the platform?",
      answer:
        "Health Assist AI is highly flexible and can be customized to match your clinic's specific needs. You can customize intake questionnaires, workflows, branding, reporting, and integrate with your existing EHR system. Our team works with you to configure the platform to match your practice's unique requirements.",
    },
    {
      question: "How long does implementation take?",
      answer:
        "Implementation time varies based on your clinic's size and customization requirements. For most practices, initial setup can be completed within 1-2 weeks, including configuration, staff training, and integration with your existing systems. Our team provides dedicated support throughout the implementation process.",
    },
    {
      question: "What kind of support do you provide?",
      answer:
        "We offer comprehensive support including email support for all plans, priority support for Professional plans, and dedicated support for Enterprise customers. We also provide training materials, video tutorials, and regular webinars to help you get the most out of the platform.",
    },
    {
      question: "Can I integrate Health Assist AI with my existing EHR?",
      answer:
        "Yes, Health Assist AI is designed to integrate with most major EHR systems. We support standard integration protocols and can work with your IT team or EHR vendor to establish seamless data flow. Contact us to discuss your specific EHR system.",
    },
    {
      question: "What happens to patient data if I cancel?",
      answer:
        "Patient data security and privacy are our top priorities. If you cancel your subscription, you can export all your data in standard formats. We maintain data according to HIPAA requirements and can assist with secure data transfer or deletion as needed.",
    },
    {
      question: "Do patients need special software or apps?",
      answer:
        "No, patients don't need to download anything. Health Assist AI works through a simple web link that you share with patients. They can complete the intake process on any device with a web browser - smartphone, tablet, or computer.",
    },
    {
      question: "How accurate is the AI-powered intake?",
      answer:
        "Our AI is trained on medical best practices and continuously improved. It captures comprehensive patient histories with high accuracy. However, all information is reviewed by healthcare providers before being added to patient records, ensuring accuracy and completeness.",
    },
  ];

  return (
    <div className="space-y-4">
      {faqs.map((faq, index) => (
        <div
          key={index}
          className="border border-gray-200 rounded-xl overflow-hidden"
        >
          <button
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            className="w-full px-6 py-4 text-left flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="font-semibold text-gray-900">{faq.question}</span>
            <svg
              className={`w-5 h-5 text-gray-600 transform transition-transform ${
                openIndex === index ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {openIndex === index && (
            <div className="px-6 py-4 bg-white text-gray-600">
              {faq.answer}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

