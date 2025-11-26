// app/components/FileUploader.tsx
"use client";

import React, { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";

export default function FileUploader() {
  const { sendMessage } = useChat();
  const [loading, setLoading] = useState(false);
  const [lastName, setLastName] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setLastName(file.name);

    try {
      const text = await readFileAsText(file);
      // Wrap content in a clearly identifiable block so the assistant knows
      const payload = `<UPLOADED_FILE name="${escapeHtml(file.name)}">\n${text}\n</UPLOADED_FILE>\n`;
      // send as a user message so the assistant sees it in the conversation
      await sendMessage({ text: payload });
    } catch (err) {
      console.error("File read failed", err);
      await sendMessage({ text: `[Upload error] Could not read file ${file.name}` });
    } finally {
      setLoading(false);
      if (e.target) e.target.value = "";
    }
  }

  // helper to read text files (txt, csv, json, xml)
  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const allowed = ["text/plain", "application/json", "text/csv", "application/xml"];
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const extAllowed = ["txt", "csv", "json", "xml"];
      if (!allowed.includes(file.type) && !extAllowed.includes(ext)) {
        reject(new Error("Unsupported file type. Use .txt, .csv, .json or .xml."));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    });
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* file input is visually hidden, we trigger it via the label */}
      <input
        type="file"
        accept=".txt,.csv,.json,.xml"
        onChange={handleFile}
        style={{ display: "none" }}
        id="file-upload-input"
      />

      {/* label wraps the button so clicking the button opens the file picker */}
      <label htmlFor="file-upload-input" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <Button variant="outline" size="sm" className="cursor-pointer">
          Upload file
        </Button>
        {loading ? (
          <span style={{ marginLeft: 8 }}>Reading {lastName || "file"}…</span>
        ) : lastName ? (
          <span style={{ marginLeft: 8 }}>{lastName}</span>
        ) : null}
      </label>
    </div>
  );
}
