import Link from "next/link"
import { ChevronRight, Zap, Star, Home, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEVICE_COST, SUBSCRIPTION_COST } from "@/lib/data";
import { createClient } from "@/utils/supabase/server"
import { getAllPersonalities } from "@/db/personalities"
import { CharacterShowcase } from "./components/LandingPage/CharacterShowcase";
import { CreateCharacterShowcase } from "./components/LandingPage/CreateCharacterShowcase";
import ProductsSection from "./components/LandingPage/ProductsSection";
import Image from "next/image";
import { fetchGithubStars } from "./actions";
import YoutubeDemo from "./components/LandingPage/YoutubeDemo";
import { kickstarterLink } from "@/lib/data";

export default async function LandingPage() {
  const supabase = createClient();
  const { stars = 0 } = await fetchGithubStars("akdeb/ElatoAI");

  const allPersonalities = await getAllPersonalities(supabase);
  const adultPersonalities = allPersonalities.filter((personality) => !personality.is_story && !personality.is_child_voice);
  return (
    <div className="flex min-h-screen flex-col bg-[#FCFAFF]">
      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full py-12 md:py-20">
          <div className="container px-4 md:px-6 max-w-screen-lg mx-auto">
            <div className="grid gap-6 lg:grid-cols-1 lg:gap-12 items-center">
              <div className="flex flex-col items-center justify-center space-y-4">
 <h1 className="text-2xl text-center md:text-3xl font-bold font-luckiestGuy tracking-widest flex flex-row items-center justify-center gap-2">
               <Image src="/logos/elato.png" alt="Elato Logo" width={40} height={40} />
<span className="mt-3">Elato</span>
                </h1>
        <div className="flex flex-row gap-2 items-center py-4"> 
          <a href={kickstarterLink} className="inline-flex w-fit items-center space-x-2 rounded-full shadow-lg bg-white px-3 py-1 text-sm text-black">
            {/* <Zap className="h-4 w-4" fill="currentColor" /> */}
            <Image src="/logos/ks.png" alt="Kickstarter" width={20} height={20} />
            <span className="inline ml-2">Follow us on Kickstarter ❤️</span>
            <ArrowUpRight className="h-5 w-5" />
          </a>
        </div>
                <h1 className="text-5xl text-center md:text-6xl font-bold tracking-tight text-purple-900" style={{ lineHeight: '1.2' }}>
               
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-500">
                  Realtime, Conversational AI
                  </span>{" "} on ESP32 with Arduino and Edge Functions
                </h1>

                <p className="text-xl text-gray-600 text-center max-w-[600px]">
                  Attach your <span className="font-silkscreen mx-1">Elato</span> device to any toy or plushie and watch them become AI characters you can talk
                  to!
                </p>
                <div className="flex items-center space-x-2 justify-center text-amber-500 my-2">
        {[...Array(5)].map((_, i) => (
          <Star key={i} className="fill-amber-500" />
        ))}
        <span className="ml-2 text-gray-700">200+ Happy Customers</span>
      </div>


                <div className="flex flex-col gap-4  sm:gap-8 pt-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link href={"https://elatoai.com/products"}>
                      <Button
                        size="lg"
                        className="w-full sm:w-auto flex-row items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white border-0 text-lg h-14"
                      >
                        <span>Get Elato Now</span>
                        <ChevronRight className="ml-2 h-5 w-5" />
                      </Button>
                    </Link>
                    
                    <Link href="/home">
                      <Button
                        size="lg"
                        variant="outline"
                        className="w-full sm:w-auto flex-row items-center gap-2 border-purple-600 text-purple-600 hover:bg-purple-50 text-lg h-14"
                      >
                        <span>See Characters</span>
                        <Home className="ml-2 h-5 w-5" />
                      </Button>
                    </Link>
                  </div>
                  
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <p className="text-gray-700 text-sm">If you like this project, please star it on GitHub!</p>
                    <a href="https://github.com/akdeb/ElatoAI" target="_blank" rel="noopener noreferrer" 
                      className="flex items-center bg-gray-900 hover:bg-gray-800 transition-colors text-white px-4 py-2 rounded-md">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 mr-2 fill-white" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      <span className="font-medium">Star on GitHub</span>
                      <span className="ml-2 bg-white text-gray-900 px-2 py-0.5 rounded-md text-xs font-bold">{stars}</span>
                    </a>
                  </div>
 
                </div>

                <div className="flex flex-row gap-2 items-center"> 
                  <div className="w-full py-8">
                    <h3 className="text-center text-sm font-medium text-gray-500 mb-6">POWERED BY</h3>
                    <div className="flex flex-wrap justify-center items-center gap-12">
                      <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/vercel.png" alt="Vercel" width={100} height={24} style={{ height: '36px', width: 'auto' }} />
                      </a>
                      <a href="https://deno.com" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/deno.png" alt="Deno" width={100} height={24} style={{ height: '36px', width: 'auto' }} />
                      </a>
                      <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/supabase.png" alt="Supabase" width={100} height={24} style={{ height: '48px', width: 'auto' }} />
                      </a>
                      <a href="https://arduino.cc" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/arduino.png" alt="Arduino" width={100} height={24} style={{ height: '36px', width: 'auto' }} />
                      </a>
                      <a href="https://espressif.com" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/espressif.png" alt="Espressif ESP32" width={100} height={24} style={{ height: '36px', width: 'auto' }} />
                      </a>
                      <a href="https://platformio.org" target="_blank" rel="noopener noreferrer" className="transition-all">
                        <Image src="/logos/platformio.png" alt="PlatformIO" width={100} height={24} style={{ height: '36px', width: 'auto' }} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <YoutubeDemo caption="Elato AI ESP32-S3 Demo" />
        {/* Products Section */}
        <ProductsSection />

                {/* How It Works */}
                <section className="w-full py-12 bg-gradient-to-b from-purple-50 to-white">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-6 text-gray-800">
                Super Simple to Use
              </h2>
              <p className="text-lg text-gray-600 mt-2">Just 3 easy steps to epic conversations</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100 transform transition-transform hover:scale-105">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-xl font-bold text-purple-600">1</span>
                </div>
                <h3 className="text-xl font-bold text-purple-900 mb-2">Attach</h3>
                <p className="text-gray-600">Attach the Elato device to any toy or plushie</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100 transform transition-transform hover:scale-105">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-xl font-bold text-purple-600">2</span>
                </div>
                <h3 className="text-xl font-bold text-purple-900 mb-2">Configure</h3>
                <p className="text-gray-600">Use our <a href="/home" className="text-purple-600">web app</a> to set up your toy's personality</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100 transform transition-transform hover:scale-105">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                  <span className="text-xl font-bold text-purple-600">3</span>
                </div>
                <h3 className="text-xl font-bold text-purple-900 mb-2">Talk</h3>
                <p className="text-gray-600">Start chatting with your toy - it's that simple!</p>
              </div>
            </div>
          </div>
        </section>


        {/* Character Showcase */}
        <CharacterShowcase allPersonalities={adultPersonalities} />

        {/* Create Character Showcase */}
        <CreateCharacterShowcase />
      </main>
    </div>
  )
}

