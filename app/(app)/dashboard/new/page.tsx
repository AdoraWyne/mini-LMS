import { BookingForm } from "@/components/consultations/booking-form";

/** /dashboard/new: book a consultation. The form is a client component; this page is just the frame. */
export default function NewConsultationPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Book a consultation</h1>
      <BookingForm />
    </div>
  );
}
