import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-16">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Local 3D Printers Bid on Your Job
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Upload your design, get competitive bids from verified local experts.
          Expert-verified quality, not algorithm-priced guesswork.
        </p>
        <div className="flex justify-center gap-4">
          <Link
            to="/register"
            className="bg-brand-600 text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-brand-700"
          >
            Get Started
          </Link>
          <Link
            to="/printers"
            className="bg-white text-brand-600 border border-brand-600 px-8 py-3 rounded-lg text-lg font-medium hover:bg-brand-50"
          >
            Browse Printers
          </Link>
        </div>
      </div>

      <div className="mt-24 grid md:grid-cols-3 gap-8">
        <div className="text-center p-6">
          <div className="text-4xl mb-4">1</div>
          <h3 className="text-lg font-semibold mb-2">Upload Your Design</h3>
          <p className="text-gray-600">
            Upload STL or 3MF files. We validate mesh quality and extract dimensions automatically.
          </p>
        </div>
        <div className="text-center p-6">
          <div className="text-4xl mb-4">2</div>
          <h3 className="text-lg font-semibold mb-2">Get Expert Bids</h3>
          <p className="text-gray-600">
            Local printers review your design and compete with transparent pricing and DfAM advice.
          </p>
        </div>
        <div className="text-center p-6">
          <div className="text-4xl mb-4">3</div>
          <h3 className="text-lg font-semibold mb-2">Print with Confidence</h3>
          <p className="text-gray-600">
            Escrow payment, quality verification, and our PrintBid Guarantee protect every order.
          </p>
        </div>
      </div>
    </div>
  );
}
