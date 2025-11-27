import React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link'; // keep other imports you need

const FileUploader = dynamic(() => import('./components/FileUploader'), { ssr: false });

export default function Page() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Chat + File upload</h1>
      <section className="mb-8">
        <h2 className="text-lg font-medium mb-2">Upload a file to the chatbot</h2>
        <div className="max-w-xl">
          <FileUploader />
        </div>
      </section>
      {/* your chat UI */}
    </main>
  );
}
