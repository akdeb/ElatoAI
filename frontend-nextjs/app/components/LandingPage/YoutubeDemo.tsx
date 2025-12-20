"use client";

import React from "react";

interface YoutubeDemoProps {
    caption: string;
	youtubeId: string;
}


export default function YoutubeDemo({ caption, youtubeId }: YoutubeDemoProps) {
    return <div className="w-full max-w-3xl mx-auto">
	<div className="relative" style={{ paddingBottom: '56.25%' }}>
	  <iframe
		className="absolute top-0 left-0 w-full h-full rounded-xl shadow-lg"
		src={`https://www.youtube.com/embed/${youtubeId}`}
		title="Elato Demo"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
		allowFullScreen
	  />
	</div>
	<p className="text-center text-gray-600 mt-4 text-lg">{caption}</p>
  </div>
}