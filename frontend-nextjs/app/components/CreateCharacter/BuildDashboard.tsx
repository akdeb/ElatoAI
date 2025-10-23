"use client";

import React, { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import HomePageSubtitles from "./../HomePageSubtitles";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Check, Volume2, Plus } from "lucide-react";
import { createPersonality } from "@/db/personalities";
import { v4 as uuidv4 } from 'uuid';
import { toast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { emotionOptions, geminiVoices, openaiVoices, r2UrlAudio } from "@/lib/data";
import EmojiComponent from "./EmojiComponent";
import { PitchFactors } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import VoiceCloneModal from "./VoiceCloneModal";
import Image from "next/image";

interface SettingsDashboardProps {
  selectedUser: IUser;
  allLanguages: ILanguage[];
}

const formSchema = z.object({
  provider: z.enum(["openai", "gemini"]),
  title: z.string().min(2, "Minimum 2 characters").max(50, "Maximum 50 characters"),
  description: z.string().min(50, "Minimum 50 characters").max(200, "Maximum 200 characters"),
  prompt: z.string().min(100, "Minimum 100 characters").max(1000, "Maximum 1000 characters"),
  firstMessagePrompt: z.string().min(50, "Minimum 50 characters").max(150, "Maximum 150 characters"),
  voice: z.string().min(1, "Voice selection is required"),
  voiceCharacteristics: z.object({
    features: z.string().min(10, "Minimum 10 characters").max(150, "Maximum 150 characters"),
    emotion: z.string(),
    pitchFactor: z.number().min(0.75).max(1.5),
  })
});

type FormData = z.infer<typeof formSchema>;

const SettingsDashboard: React.FC<SettingsDashboardProps> = ({
  selectedUser,
}) => {
  const supabase = createClient();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<'personality' | 'voice'>('personality');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    provider: 'openai' as ModelProvider,
    title: '',
    description: '',
    prompt: '',
    firstMessagePrompt: '',
    voice: '',
    voiceCharacteristics: {
      features: '',
      emotion: 'neutral',
      pitchFactor: 1.0,
    }
  });

  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData | 'features', string>>>({});
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  const handleBlur = (field: keyof FormData | 'features') => {
    // Mark the field as touched
    setTouchedFields(prev => ({ ...prev, [field]: true }));

    // Validate the field
    if (field === 'features') {
      validateField(field, formData.voiceCharacteristics.features);
    } else {
      validateField(field, formData[field] as string);
    }
  };

  const validateField = (field: keyof FormData | 'features', value: string) => {
    try {
      if (field === 'features') {
        formSchema.shape.voiceCharacteristics.shape.features.parse(value);
      } else if (field === 'voiceCharacteristics') {
        formSchema.shape.voiceCharacteristics.parse(value);
      } else {
        formSchema.shape[field].parse(value);
      }
      // Clear error if validation passes
      setFormErrors(prev => ({ ...prev, [field]: undefined }));
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        const zodError = error as z.ZodError;
        setFormErrors(prev => ({ ...prev, [field]: zodError.errors[0].message }));
      }
    }
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);

    // Only validate if the field has been touched before
    if (touchedFields[field]) {
      validateField(field, value);
    }
  };

  const handleVoiceCharacteristicChange = (characteristic: 'features' | 'emotion' | 'pitchFactor', value: string | number) => {
    const newVoiceCharacteristics = {
      ...formData.voiceCharacteristics,
      [characteristic]: characteristic === 'pitchFactor' ? Number(value) : value
    };

    // Validate just this nested field
    try {
      if (characteristic === 'pitchFactor') {
        formSchema.shape.voiceCharacteristics.shape.pitchFactor.parse(newVoiceCharacteristics[characteristic]);
      } else {
        formSchema.shape.voiceCharacteristics.shape[characteristic].parse(newVoiceCharacteristics[characteristic]);
      }
      // Clear error if validation passes
      setFormErrors(prev => ({ ...prev, [characteristic]: undefined }));
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        const zodError = error as z.ZodError;
        setFormErrors(prev => ({ ...prev, [characteristic]: zodError.errors[0].message }));
      }
    }

    setFormData({
      ...formData,
      voiceCharacteristics: newVoiceCharacteristics
    });
  };


  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Set submitting state to true
    setIsSubmitting(true);

    // Validate the entire form
    const result = formSchema.safeParse(formData);
    console.log(result);

    if (!result.success) {
      // Extract and set all validation errors
      const errors: Partial<Record<keyof FormData | 'features', string>> = {};
      result.error.errors.forEach(err => {
        const path = err.path.join('.');
        if (path === 'voiceCharacteristics.features') {
          errors['features'] = err.message;
        } else {
          errors[err.path[0] as keyof FormData] = err.message;
        }
      });
      setFormErrors(errors);
      setIsSubmitting(false); // Reset submitting state
      return;
    }

    try {
      const personality = await createPersonality(supabase, selectedUser.user_id, {
        provider: formData.provider as ModelProvider,
        title: formData.title,
        subtitle: "",
        character_prompt: formData.prompt,
        oai_voice: formData.voice as OaiVoice,
        voice_prompt: formData.voiceCharacteristics.features + "\nThe voice should be " + formData.voiceCharacteristics.emotion,
        is_doctor: false,
        is_child_voice: false,
        is_story: false,
        key: formData.title.toLowerCase().replace(/ /g, '_') + "_" + uuidv4(),
        creator_id: selectedUser.user_id,
        short_description: formData.description,
        pitch_factor: formData.voiceCharacteristics.pitchFactor,
        first_message_prompt: formData.firstMessagePrompt
      });

      if (personality) {
        toast({
          title: "New AI Character created",
          description: "Your character has been created!",
          duration: 3000,
        });
        router.push(`/home`);
      }
    } catch (error) {
      console.error("Error creating personality:", error);
      toast({
        title: "Error",
        description: "Failed to create your character. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsSubmitting(false); // Reset submitting state
    }
  };

  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [showVoiceCloneModal, setShowVoiceCloneModal] = useState<{
    provider: "elevenlabs" | "hume";
    title: string;
    voiceInputLabel: string;
    voiceInputPlaceholder: string;
    voiceDescription: string;
} | null>(null);


  const previewVoice = (voice: VoiceType) => {
    const { id, provider } = voice;

    if (provider === 'openai') {
      // Stop any currently playing preview
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }

      const audioSampleUrl = `${r2UrlAudio}/${id}.wav`;
      setPreviewingVoice(id);

      // Create and play audio element
      const audio = new Audio(audioSampleUrl);
      setAudioElement(audio);

      // Play the audio
      audio.play().catch(error => {
        console.error("Error playing audio:", error);
        setPreviewingVoice(null);
      });

      // Reset the previewing state when audio ends
      audio.onended = () => {
        setPreviewingVoice(null);
      };

      // Fallback in case audio doesn't trigger onended
      setTimeout(() => {
        if (previewingVoice === id) {
          setPreviewingVoice(null);
        }
      }, 10000); // 10 second fallback
    }
  }

  const Heading = () => {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-4 items-center sm:justify-normal justify-between max-w-screen-sm">
          <div className="flex flex-row gap-4 items-center justify-between w-full">
            <h1 className="text-3xl font-normal">Create your AI Character</h1>
          </div>
        </div>
        {/* <HomePageSubtitles user={selectedUser} page="create" /> */}
      </div>
    );
  };

  return (
    <div className="overflow-hidden pb-2 w-full flex-auto flex flex-col pl-1 max-w-screen-sm">
      <Heading />

      <form onSubmit={handleSubmit} className="space-y-6 mt-8 w-full pr-1">
        {currentStep === 'personality' ?
          <div className="space-y-4">
            {/* Voice Picker */}
            <div className="space-y-4">
              <Label htmlFor="voice">Pick a voice</Label>
              <p className="text-sm text-gray-500">
                Click a voice to preview how it sounds.
              </p>

              <div className="overflow-x-auto px-2">
                <div className="flex gap-3 w-max py-2">
                  {[...openaiVoices, ...geminiVoices].map((voice: VoiceType) => (
                    <div
                      key={voice.id}
                      className={`relative rounded-xl border-2 p-4 transition-all cursor-pointer hover:scale-[1.02] hover:shadow-lg w-48 flex-shrink-0 ${formData.voice === voice.id
                        ? `border-blue-500 shadow-lg ${voice.color} ring-2 ring-blue-200`
                        : `border-gray-200 hover:border-gray-300 ${voice.color} hover:shadow-md`
                        }`}
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          provider: voice.provider as ModelProvider,
                          voice: voice.id
                        }));
                        previewVoice(voice);
                      }}
                    >
                      <div className="flex flex-col">
                        <div className="flex flex-col items-center gap-3">
                          <div className="text-3xl">
                            <EmojiComponent emoji={voice.emoji} />
                          </div>
                          <div className="flex flex-col text-center">
                            <span className="font-semibold text-gray-900">{voice.name}</span>
                            <span className="text-xs text-gray-600 mt-1">{voice.description}</span>
                            <div className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium mt-2 ${voice.provider === 'openai' ? 'bg-emerald-500 text-white' : 'bg-purple-500 text-white'
                              }`}>
                              {voice.provider === 'openai' ? 'OpenAI' : 'Gemini'}
                            </div>
                          </div>
                        </div>
                        {previewingVoice === voice.id && (
                          <div className="absolute top-3 right-3">
                            <div className="animate-pulse text-blue-600 bg-white rounded-full p-2 shadow-lg">
                              <Volume2 size={16} />
                            </div>
                          </div>
                        )}
                        {formData.voice === voice.id && (
                          <div className="absolute -top-2 -right-2">
                            <div className="bg-blue-500 text-white rounded-full p-1.5 shadow-lg">
                              <Check size={12} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ElevenLabs Alternative */}
            <div className="space-y-3 p-4 bg-yellow-100 rounded-lg border border-gray-200">
              <div className="flex items-start sm:flex-row gap-4 flex-col justify-between">
                <div>
                  <Label className="text-sm font-medium">Creating an Eleven Labs or Hume Character?</Label>
                  <p className="text-xs text-gray-500 mt-1">
                    Create Voice AI Characters with 11Labs Conversational AI Agents or Hume EVI4. You are responsible for obtaining proper consent and ensuring ethical use of all voice clones.

                  </p>
                </div>
<div className="flex flex-row sm:flex-col gap-2 justify-end">
<Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVoiceCloneModal({ provider: "hume", title: "Hume Character", voiceInputLabel: "Hume Config ID", voiceInputPlaceholder: "your-hume-config-id-here", voiceDescription: "Find this in your Hume playground in configurations" })}
                  className="flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  Hume EVI4
                </Button>
<Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVoiceCloneModal({ provider: "elevenlabs", title: "Eleven Labs Character", voiceInputLabel: "Eleven Labs Agent ID", voiceInputPlaceholder: "your-elevenlabs-agent-id-here", voiceDescription: "Find this in your Eleven Labs dashboard in agent settings" })}
                  className="flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  Eleven Labs Agent
                </Button>
</div>
              </div>

            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="AI Hulk"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                onBlur={() => handleBlur('title')}
              />
              <p className="text-sm flex justify-between">
                <span className={formErrors.title ? "text-red-500" : "text-gray-500"}>
                  {formErrors.title}
                </span>
                <span className="text-gray-500">{formData.title.length}/50</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what your AI character does and its personality..."
                rows={2}
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                onBlur={() => handleBlur('description')} />
              <p className="text-sm flex justify-between">
                <span className={formErrors.description ? "text-red-500" : "text-gray-500"}>
                  {formErrors.description}
                </span>
                <span className="text-gray-500">{formData.description.length}/200</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="Enter specific instructions for how your AI should respond..."
                rows={4}
                value={formData.prompt}
                onChange={(e) => handleInputChange('prompt', e.target.value)}
                onBlur={() => handleBlur('prompt')}
              />
              <p className="text-sm flex justify-between">
                <span className={formErrors.prompt ? "text-red-500" : "text-gray-500"}>
                  {formErrors.prompt}
                </span>
                <span className="text-gray-500">{formData.prompt.length}/1000</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstMessagePrompt">First message prompt</Label>
              <Textarea
                id="firstMessagePrompt"
                placeholder="How your AI character should respond in the first message to the user..."
                rows={4}
                value={formData.firstMessagePrompt}
                onChange={(e) => handleInputChange('firstMessagePrompt', e.target.value)}
                onBlur={() => handleBlur('firstMessagePrompt')}
              />
              <p className="text-sm flex justify-between">
                <span className={formErrors.firstMessagePrompt ? "text-red-500" : "text-gray-500"}>
                  {formErrors.firstMessagePrompt}
                </span>
                <span className="text-gray-500">{formData.firstMessagePrompt.length}/150</span>
              </p>
            </div>
          </div> :
          <div className="space-y-6">
            {/* Pitch Slider */}
            <div className="flex flex-col gap-4 -pt-6 pb-4">
              <Label htmlFor="pitchFactor">Voice Pitch</Label>
              <p className="text-sm text-gray-500">
                Slide to adjust voice depth on your device
              </p>

              <div className="space-y-6">
                <Slider
                  id="pitchFactor"
                  min={0.75}
                  max={1.5}
                  step={0.25}
                  value={[formData.voiceCharacteristics.pitchFactor]}
                  onValueChange={(value: number[]) => {
                    handleVoiceCharacteristicChange('pitchFactor', value[0]);
                  }}
                  className="w-full"
                />

                <div className="flex justify-between text-sm">
                  {PitchFactors.map((item, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-1">
                      <EmojiComponent emoji={item.emoji} />
                      <span className="font-medium">{item.label}</span>
                      <span className="text-xs hidden sm:block text-gray-500">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>


            {/* Voice Characteristics Textarea */}
            <div className="space-y-2">
              <Label htmlFor="voiceCharacteristics">Characteristics</Label>
              <Textarea
                id="voiceCharacteristics"
                placeholder="e.g., Medium pitch, Normal speed, Clear voice"
                className="w-full min-h-16"
                rows={2}
                value={formData.voiceCharacteristics.features}
                onChange={(e) => {
                  const value = e.target.value;
                  setFormData((prev) => ({
                    ...prev,
                    voiceCharacteristics: {
                      ...prev.voiceCharacteristics,
                      features: value,
                    },
                  }));
                  if (touchedFields['features']) {
                    validateField('features', value);
                  }
                }}
                onBlur={() => handleBlur('features')}
              />
              <p className="text-sm flex justify-between">
                <span className={formErrors.features ? 'text-red-500' : 'text-gray-500'}>
                  {formErrors.features}
                </span>
                <span className="text-gray-500">
                  {formData.voiceCharacteristics.features.length}/150
                </span>
              </p>
            </div>

            {/* Emotional Tone Picker */}
            <div className="space-y-4 pb-2">
              <Label className="block mb-2">Emotional Tone</Label>
              <div className="grid grid-cols-3 gap-3">
                {emotionOptions.map((emotion) => (
                  <div
                    key={emotion.value}
                    className={`
                  rounded-lg border p-3 cursor-pointer transition-all
                  ${formData.voiceCharacteristics.emotion === emotion.value
                        ? 'border-2 border-blue-500 shadow-sm ' + emotion.color
                        : 'border-gray-200 hover:border-gray-300'
                      }
                `}
                    onClick={() =>
                      handleVoiceCharacteristicChange('emotion', emotion.value)
                    }
                  >
                    <div className="flex flex-col items-center text-center">
                      <EmojiComponent emoji={emotion.icon} />
                      <span className="text-sm font-medium">{emotion.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }

        {currentStep === 'personality' ? (
          <Button
            onClick={() => setCurrentStep('voice')}
            className="ml-auto flex flex-row gap-2 items-center"
          >
            Voice Features <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <div className="w-full flex justify-between">
            <Button
              variant="outline"
              className="flex flex-row gap-2 items-center"
              onClick={() => setCurrentStep('personality')}
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              variant="default"
              className="flex flex-row gap-2 items-center"
              type="submit"
              disabled={
                isSubmitting ||
                formData.title === '' ||
                formData.description === '' ||
                formData.prompt === '' ||
                formData.voice === '' ||
                formData.voiceCharacteristics.features === ''
              }
            >
              {isSubmitting ? "Creating..." : "Create"} {!isSubmitting && <Check className="w-4 h-4" />}
            </Button>
          </div>
        )}
      </form>
      <VoiceCloneModal
        isOpen={!!showVoiceCloneModal}
        onClose={() => setShowVoiceCloneModal(null)}
        selectedUser={selectedUser}
        onSuccess={() => {
          // Optionally refresh personalities or show success message
          toast({
            title: "Success",
            description: "Voice clone character added successfully!",
          });
          router.push('/home');
        }}
        voiceCloneModalProps={showVoiceCloneModal!}
      />
    </div>
  )
};

export default SettingsDashboard;