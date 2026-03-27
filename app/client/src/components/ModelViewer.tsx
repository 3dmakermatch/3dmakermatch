import React, { Suspense, useMemo } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, PerspectiveCamera } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

function STLModel({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);

  const computedGeometry = useMemo(() => {
    geometry.computeBoundingBox();
    geometry.center();
    return geometry;
  }, [geometry]);

  return (
    <mesh geometry={computedGeometry}>
      <meshStandardMaterial color="#6366f1" metalness={0.1} roughness={0.6} />
    </mesh>
  );
}

export interface ModelViewerProps {
  fileUrl: string;
  fileName: string;
  className?: string;
}

function ModelViewerInner({ fileUrl, fileName }: ModelViewerProps) {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext !== 'stl') {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 rounded text-gray-500 text-sm">
        Preview not available for .{ext} files
      </div>
    );
  }

  return (
    <Canvas>
      <PerspectiveCamera makeDefault position={[0, 0, 200]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Suspense fallback={null}>
        <Center>
          <STLModel url={fileUrl} />
        </Center>
      </Suspense>
      <OrbitControls enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          Preview not available
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ModelViewer(props: ModelViewerProps) {
  return (
    <div className={`bg-gray-50 rounded-lg border ${props.className ?? 'h-64 w-full'}`}>
      <ErrorBoundary>
        <ModelViewerInner {...props} />
      </ErrorBoundary>
    </div>
  );
}
