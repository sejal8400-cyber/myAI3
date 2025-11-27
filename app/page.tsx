import dynamic from 'next/dynamic';
import React from 'react';

const FileUploader = dynamic(() => import('@/components/FileUploader'), { ssr: false });

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

      <section>
        <h2 className="text-lg font-medium">Chat interface</h2>
        {/* Keep your chat UI here (server or client), but ensure the chat UI that depends on client hooks also uses 'use client' or dynamic import */}
        <p className="text-sm text-muted-foreground">Chat area goes here.</p>
      </section>
    </main>
  );
}

