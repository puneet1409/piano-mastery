"use client";

import React from "react";

interface SessionHeaderProps {
  sessionNumber: number;
  skillsCompleted: number;
  totalSkills: number;
  sessionDuration: number; // in seconds
}

export default function SessionHeader({
  sessionNumber,
  skillsCompleted,
  totalSkills,
  sessionDuration,
}: SessionHeaderProps) {
  const progress = (skillsCompleted / totalSkills) * 100;
  const minutes = Math.floor(sessionDuration / 60);
  const seconds = sessionDuration % 60;

  return (
    <div className="bg-white shadow-md rounded-lg p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-800">
          Session {sessionNumber}
        </h1>
        <div className="text-sm text-gray-600">
          {minutes}:{seconds.toString().padStart(2, "0")} elapsed
        </div>
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Progress</span>
          <span>
            {skillsCompleted} / {totalSkills} skills
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className="bg-primary-500 h-full transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-2">
        {totalSkills - skillsCompleted} skills remaining
      </div>
    </div>
  );
}
