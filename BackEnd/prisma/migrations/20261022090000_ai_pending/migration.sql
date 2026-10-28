-- Reserve quota before sending an AI request, including concurrent in-flight calls.
ALTER TYPE "AiCallStatus" ADD VALUE IF NOT EXISTS 'pending';
