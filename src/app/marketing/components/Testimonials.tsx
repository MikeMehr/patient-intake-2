"use client";

export default function Testimonials() {
  const testimonials = [
    {
      name: "Dr. Sarah Chen",
      role: "Family Physician",
      location: "Toronto, ON",
      image: "👩‍⚕️",
      rating: 5,
      text: "Health Assist AI has transformed my practice. I've reduced my administrative time by 40% and can focus more on patient care. The HIPAA compliance gives me complete peace of mind.",
    },
    {
      name: "Dr. Michael Thompson",
      role: "Internal Medicine Specialist",
      location: "Vancouver, BC",
      image: "👨‍⚕️",
      rating: 5,
      text: "As a physician who helped design this platform, I can attest to how well it understands our workflow needs. The customization options are exactly what we needed for our clinic.",
    },
    {
      name: "Dr. Emily Rodriguez",
      role: "Pediatrician",
      location: "Montreal, QC",
      image: "👩‍⚕️",
      rating: 5,
      text: "The AI-powered intake process is incredibly smooth. Patients love the conversational interface, and I love having comprehensive histories ready before I even see them.",
    },
  ];

  return (
    <section id="testimonials" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Trusted by Physicians Across Canada
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            See what your colleagues are saying about Health Assist AI
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-xl p-8 shadow-md hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center mb-4">
                <div className="text-4xl mr-4">{testimonial.image}</div>
                <div>
                  <h4 className="font-semibold text-gray-900">
                    {testimonial.name}
                  </h4>
                  <p className="text-sm text-gray-600">{testimonial.role}</p>
                  <p className="text-xs text-gray-500">{testimonial.location}</p>
                </div>
              </div>

              <div className="flex mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <svg
                    key={i}
                    className="w-5 h-5 text-yellow-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>

              <p className="text-gray-700 italic">"{testimonial.text}"</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

























