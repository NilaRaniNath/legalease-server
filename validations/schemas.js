const { z } = require("zod");

const emailSchema = z.string().email("Invalid email format");

const lawyerProfileSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  email: emailSchema,
  name: z.string().min(1, "Name is required").optional(),
  bio: z.string().max(2000, "Bio too long").optional(),
  fee: z.union([z.number().positive("Fee must be positive"), z.string().regex(/^\d+(\.\d+)?$/, "Fee must be a number")]).optional(),
  specialization: z.string().min(1).optional(),
  image: z.string().url("Image must be a valid URL").or(z.literal("/default-avatar.png")).optional(),
  status: z.enum(["Available", "Busy"]).optional(),
  isPublished: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

const lawyerEmailQuerySchema = z.object({
  email: emailSchema,
});

const lawyerEmailParamSchema = z.object({
  email: emailSchema,
});

const lawyerUserIdParamSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

const lawyerAllQuerySchema = z.object({
  search: z.string().max(100).optional(),
  specialization: z.string().max(50).optional(),
  minFee: z.string().regex(/^(\d+(\.\d+)?)?$/, "minFee must be a number").optional(),
  maxFee: z.string().regex(/^(\d+(\.\d+)?)?$/, "maxFee must be a number").optional(),
  status: z.string().max(20).optional(),
  page: z.string().regex(/^\d+$/, "page must be a positive integer").optional(),
  limit: z.string().regex(/^\d+$/, "limit must be a positive integer").optional(),
});

const paymentConfirmSchema = z.object({
  session_id: z.string().min(1, "Stripe Session ID is required"),
  email: emailSchema.optional(),
}).passthrough();

const hiringRequestSchema = z.object({
  lawyerId: z.string().min(1, "Lawyer ID is required"),
  lawyerName: z.string().min(1).optional(),
  lawyerEmail: emailSchema.optional(),
  specialization: z.string().max(100).optional(),
  fee: z.union([z.number().nonnegative(), z.string().max(20)]).optional(),
  clientEmail: emailSchema,
  clientName: z.string().min(1).max(100).optional(),
  message: z.string().max(2000).optional(),
}).passthrough();

const hiringEmailParamSchema = z.object({
  email: emailSchema,
});

const hiringStatusBodySchema = z.object({
  status: z.enum(["accepted", "rejected"], "Status must be accepted or rejected"),
});

const hiringIdParamSchema = z.object({
  id: z.string().min(1, "Hiring ID is required"),
});

const userEmailParamSchema = z.object({
  email: emailSchema,
});

const userUpsertBodySchema = z.object({
  name: z.string().max(100).optional(),
  image: z.string().max(500).optional(),
  role: z.enum(["user", "lawyer", "admin"]).optional(),
});

const userUpdateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  image: z.string().max(500).optional(),
});

const commentCreateSchema = z.object({
  lawyerId: z.string().min(1, "Lawyer ID is required"),
  userEmail: emailSchema,
  userName: z.string().min(1).max(100).optional(),
  commentText: z.string().min(1, "Comment cannot be empty").max(2000, "Comment too long"),
});

const commentIdParamSchema = z.object({
  id: z.string().min(1),
});

const userCommentsQuerySchema = z.object({
  email: emailSchema,
});

const commentUpdateBodySchema = z.object({
  commentText: z.string().min(1, "Comment cannot be empty").max(2000, "Comment too long"),
  userEmail: emailSchema,
});

const commentDeleteQuerySchema = z.object({
  email: emailSchema,
});

const hiringsCheckQuerySchema = z.object({
  clientEmail: emailSchema,
  lawyerId: z.string().min(1, "Lawyer ID is required"),
});

const analyzeIssueSchema = z.object({
  issue: z
    .string()
    .min(10, "Please describe your issue in at least 10 characters")
    .max(5000, "Issue description is too long (max 5000 characters)"),
});

const userIdParamSchema = z.object({
  id: z.string().min(1),
});

const userRoleBodySchema = z.object({
  role: z.enum(["user", "lawyer", "admin"], "Invalid role"),
});

const messageCreateSchema = z.object({
  hiringId: z.string().min(1, "Hiring ID is required"),
  senderEmail: emailSchema,
  senderName: z.string().min(1).max(100).optional(),
  receiverEmail: emailSchema,
  text: z
    .string()
    .min(1, "Message cannot be empty")
    .max(4000, "Message is too long (max 4000 characters)"),
});

const messageHiringIdParamSchema = z.object({
  hiringId: z.string().min(1, "Hiring ID is required"),
});

const messageIdParamSchema = z.object({
  id: z.string().min(1, "Message ID is required"),
});

const messageReadBodySchema = z.object({
  readerEmail: emailSchema,
});

// ---- Case Tracking (Multi-Party) ----
const CASE_STAGE_TITLES = [
  "Consultation",
  "Evidence Gathering",
  "Filing",
  "Hearing",
  "Verdict",
];

const caseCreateSchema = z.object({
  hiringId: z.string().min(1, "Hiring ID is required"),
  title: z.string().min(1, "Case title is required").max(200, "Case title too long"),
  clientUserId: z.string().min(1).optional(),
  clientEmail: emailSchema,
  clientName: z.string().min(1).max(100).optional(),
  lawyerUserId: z.string().min(1).optional(),
  lawyerEmail: emailSchema.optional(),
  lawyerName: z.string().min(1).max(100).optional(),
  specialization: z.string().max(100).optional(),
}).passthrough();

const caseIdParamSchema = z.object({
  id: z.string().min(1, "Case ID is required"),
});

const caseUserIdParamSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

const caseUserQuerySchema = z.object({
  email: emailSchema.optional(),
});

const caseNoteSchema = z.object({
  text: z.string().min(1, "Note cannot be empty").max(2000, "Note too long"),
  authorEmail: emailSchema.optional(),
  authorName: z.string().max(100).optional(),
  role: z.enum(["user", "lawyer", "admin"]).optional(),
});

const caseStatusBodySchema = z
  .object({
    caseStatus: z.enum(["active", "on_hold", "completed", "closed"]).optional(),
    advance: z.boolean().optional(),
    setStage: z
      .number()
      .int("Stage index must be an integer")
      .min(0)
      .max(CASE_STAGE_TITLES.length - 1, "Invalid stage index")
      .optional(),
    completeCurrentStage: z.boolean().optional(),
    note: caseNoteSchema.optional(),
    stageDate: z.string().optional(),
  })
  .refine(
    (v) =>
      v.caseStatus !== undefined ||
      v.advance === true ||
      v.setStage !== undefined ||
      v.completeCurrentStage === true ||
      v.note !== undefined,
    {
      message:
        "Provide at least one update: caseStatus, advance, setStage, completeCurrentStage, or note",
      path: ["caseStatus"],
    }
  );

// ---- Availability & Bookings ----
const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const availabilityBodySchema = z.object({
  lawyerEmail: emailSchema,
  slots: z
    .array(
      z.object({
        day: z.enum(WEEK_DAYS, "Invalid day"),
        start: z.string().regex(timeRegex, "Start time must be in HH:mm format"),
        end: z.string().regex(timeRegex, "End time must be in HH:mm format"),
      })
    )
    .min(1, "At least one time slot is required")
    .max(50, "Too many slots"),
});

const availabilityQuerySchema = z.object({
  lawyerEmail: emailSchema,
});

const bookingCreateSchema = z.object({
  lawyerEmail: emailSchema,
  lawyerName: z.string().min(1).max(100).optional(),
  clientEmail: emailSchema,
  clientName: z.string().min(1).max(100).optional(),
  date: z.string().regex(dateRegex, "Invalid date (expected YYYY-MM-DD)"),
  startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format"),
  endTime: z.string().regex(timeRegex, "End time must be in HH:mm format"),
  notes: z.string().max(1000, "Notes too long").optional(),
});

const bookingQuerySchema = z
  .object({
    lawyerEmail: emailSchema.optional(),
    clientEmail: emailSchema.optional(),
  })
  .refine((s) => Boolean(s.lawyerEmail || s.clientEmail), {
    message: "Provide lawyerEmail or clientEmail",
    path: ["lawyerEmail"],
  });

const bookingIdParamSchema = z.object({
  id: z.string().min(1, "Booking ID is required"),
});

const bookingStatusBodySchema = z.object({
  status: z.enum(["accepted", "rejected", "completed", "cancelled"], "Invalid booking status"),
  replyNote: z.string().max(1000, "Reply note too long").optional(),
});

module.exports = {
  emailSchema,
  lawyerProfileSchema,
  lawyerEmailQuerySchema,
  lawyerEmailParamSchema,
  lawyerUserIdParamSchema,
  lawyerAllQuerySchema,
  paymentConfirmSchema,
  hiringRequestSchema,
  hiringEmailParamSchema,
  hiringStatusBodySchema,
  hiringIdParamSchema,
  userEmailParamSchema,
  userUpsertBodySchema,
  userUpdateProfileSchema,
  commentCreateSchema,
  commentIdParamSchema,
  userCommentsQuerySchema,
  commentUpdateBodySchema,
  commentDeleteQuerySchema,
  hiringsCheckQuerySchema,
  analyzeIssueSchema,
  userIdParamSchema,
  userRoleBodySchema,
  messageCreateSchema,
  messageHiringIdParamSchema,
  messageIdParamSchema,
  messageReadBodySchema,
  availabilityBodySchema,
  availabilityQuerySchema,
  bookingCreateSchema,
  bookingQuerySchema,
  bookingIdParamSchema,
  bookingStatusBodySchema,
  caseCreateSchema,
  caseIdParamSchema,
  caseUserIdParamSchema,
  caseUserQuerySchema,
  caseNoteSchema,
  caseStatusBodySchema,
};