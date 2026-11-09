import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub, RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CourseStatus, RefundStatus, UserRole, refunds } from "~/db/schema";
import { getCountryTierInfo } from "~/lib/ppp";
import CourseDetail, { loader as courseLoader } from "./courses.$slug";
import { action as requestRefund } from "./courses.$slug.refund";
import Settings, { loader as settingsLoader } from "./settings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  all: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
}));

vi.mock("~/db", () => {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    values: mocks.values,
    get: mocks.get,
    all: mocks.all,
  };
  mocks.values.mockReturnValue(query);
  mocks.insert.mockReturnValue(query);
  return { db: { select: vi.fn(() => query), insert: mocks.insert } };
});

const course = {
  id: 1,
  title: "TypeScript Essentials",
  slug: "typescript-essentials",
  description: "Learn TypeScript",
  salesCopy: "Learn TypeScript",
  instructorId: 2,
  categoryId: 1,
  status: CourseStatus.Published,
  coverImageUrl: null,
  price: 7900,
  pppEnabled: true,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  instructorName: "Taylor",
  instructorAvatarUrl: null,
  instructorBio: null,
  categoryName: "Programming",
  modules: [],
};

const user = {
  id: 1,
  name: "Liam",
  email: "liam@example.com",
  bio: null,
  role: UserRole.Student,
};

const purchase = {
  id: 10,
  userId: user.id,
  courseId: course.id,
  amountPaid: 7900,
  country: null,
  createdAt: new Date(2026, 10, 1, 12).toISOString(),
};

function actionArgs(reason = "I bought the wrong course.") {
  const formData = new FormData();
  formData.set("reason", reason);
  return {
    request: new Request(`http://localhost/courses/${course.slug}/refund`, {
      method: "POST",
      body: formData,
    }),
    params: { slug: course.slug },
    url: new URL(`http://localhost/courses/${course.slug}/refund`),
    pattern: "/courses/:slug/refund",
    context: new RouterContextProvider(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 9, 12));
  mocks.get.mockReset();
  mocks.all.mockReset().mockReturnValue([]);
  mocks.getCurrentUserId.mockResolvedValue(user.id);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("course refund terminology", () => {
  const loaderData: Awaited<ReturnType<typeof courseLoader>> = {
    course,
    salesCopyHtml: "",
    lessonCount: 0,
    enrolled: true,
    progress: 0,
    lessonProgressMap: {},
    nextLessonId: null,
    currentUserId: user.id,
    pppPrice: course.price,
    tierInfo: getCountryTierInfo(null),
    ratingSummary: { average: 0, count: 0 },
    userRating: null,
    refundOffer: { amount: 7900, lastDayInWindow: "2026-11-15" },
  };

  it.each([true, false])(
    "shows the refund control only when an offer exists: %s",
    (eligible) => {
      const Stub = createRoutesStub([
        {
          id: "course",
          path: "/courses/:slug",
          Component: CourseDetail,
        },
      ]);
      const html = renderToStaticMarkup(
        <Stub
          initialEntries={[`/courses/${course.slug}`]}
          hydrationData={{
            loaderData: {
              course: {
                ...loaderData,
                refundOffer: eligible ? loaderData.refundOffer : null,
              },
            },
          }}
        />
      );

      expect(html.includes("Request a refund</button>")).toBe(eligible);
      expect(html).not.toMatch(/Cancel my purchase|reversal|chargeback/i);
    }
  );
});

describe("settings refund terminology", () => {
  it.each([0, 1, 2])("renders %i refund requests accurately", (count) => {
    const loaderData: Awaited<ReturnType<typeof settingsLoader>> = {
      user,
      refundRequests: Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        courseTitle: course.title,
        courseSlug: course.slug,
        amountPaid: purchase.amountPaid,
        reason: "I bought the wrong course.",
        requestedAt: "2026-11-09T12:00:00.000Z",
      })),
    };
    const Stub = createRoutesStub([
      { id: "settings", path: "/settings", Component: Settings },
    ]);
    const html = renderToStaticMarkup(
      <Stub
        initialEntries={["/settings"]}
        hydrationData={{ loaderData: { settings: loaderData } }}
      />
    );

    expect(html.includes("Refund requests</h2>")).toBe(count > 0);
    expect(html.match(/>Requested<\/span>/g) ?? []).toHaveLength(count);
    if (count > 0) {
      expect(html).toContain(
        count === 1
          ? "One refund request is awaiting review."
          : `${count} refund requests are awaiting review.`
      );
      expect(html).toContain(`href="/courses/${course.slug}"`);
      expect(html).toContain("$79.00");
    }
    expect(html).not.toMatch(/chargeback|reversal/i);
  });

  it("returns refund requests from the settings loader", async () => {
    const refundRequests = [{ id: 1, courseTitle: course.title }];
    mocks.get.mockReturnValueOnce(user);
    mocks.all.mockReturnValueOnce(refundRequests);

    const result = await settingsLoader({
      request: new Request("http://localhost/settings"),
      params: {},
      url: new URL("http://localhost/settings"),
      pattern: "/settings",
      context: new RouterContextProvider(),
    });

    expect(result).toEqual({ user, refundRequests });
  });
});

describe("refund request action", () => {
  function prepareRequest(
    options: {
      purchase?: typeof purchase;
      existingRequest?: { id: number };
      claimedSeat?: { id: number };
    } = {}
  ) {
    mocks.get
      .mockReturnValueOnce(course)
      .mockReturnValueOnce(user)
      .mockReturnValueOnce(options.purchase ?? purchase)
      .mockReturnValueOnce(options.existingRequest)
      .mockReturnValueOnce(options.claimedSeat);
  }

  it("records a request, redirects, and confirms a request rather than a completed refund", async () => {
    prepareRequest();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await requestRefund(actionArgs());

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
      throw new Error("Expected a redirect response");
    }
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/settings");
    expect(mocks.insert).toHaveBeenCalledWith(refunds);
    expect(mocks.values).toHaveBeenCalledWith({
      purchaseId: purchase.id,
      status: RefundStatus.Requested,
      reason: "I bought the wrong course.",
    });
    expect(log).toHaveBeenCalledOnce();
    const message = log.mock.calls[0]?.[0];
    expect(message).toContain(
      "subject=Refund requested — TypeScript Essentials"
    );
    expect(message).toContain(
      'We have received your refund request for "TypeScript Essentials".'
    );
    expect(message).toContain("The requested refund is for $79.00");
    expect(message).toContain("Our team reviews every refund request by hand.");
    expect(message).not.toMatch(/reversal|chargeback|cancel/i);
  });

  it("asks for a refund reason without cancellation terminology", async () => {
    prepareRequest();

    await expect(requestRefund(actionArgs("Wrong"))).resolves.toMatchObject({
      data: {
        errors: {
          reason: "Tell us a little more about why you want a refund.",
        },
      },
      init: { status: 400 },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("requires sign-in to request a refund", async () => {
    mocks.getCurrentUserId.mockResolvedValue(null);

    await expect(requestRefund(actionArgs())).rejects.toMatchObject({
      data: "You must be logged in to request a refund.",
      init: { status: 401 },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects duplicate refund requests", async () => {
    prepareRequest({ existingRequest: { id: 1 } });

    await expect(requestRefund(actionArgs())).rejects.toMatchObject({
      data: "You already have a refund request open on this purchase.",
      init: { status: 409 },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("retains the claimed-team-seat restriction", async () => {
    prepareRequest({ claimedSeat: { id: 1 } });

    await expect(requestRefund(actionArgs())).rejects.toMatchObject({
      data: "A claimed team seat is not eligible for a refund.",
      init: { status: 403 },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([14, 15])("retains the refund window at day %i", async (days) => {
    const purchasedAt = new Date(2026, 10, 9 - days, 23);
    prepareRequest({
      purchase: { ...purchase, createdAt: purchasedAt.toISOString() },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    if (days === 14) {
      await expect(requestRefund(actionArgs())).resolves.toBeInstanceOf(
        Response
      );
      expect(mocks.insert).toHaveBeenCalledOnce();
    } else {
      await expect(requestRefund(actionArgs())).rejects.toMatchObject({
        data: "The 14-day refund window has closed.",
        init: { status: 403 },
      });
      expect(mocks.insert).not.toHaveBeenCalled();
    }
  });

  it.each([7199, 7200])(
    "retains the two-hour watch limit at %i seconds",
    async (watchedSeconds) => {
      prepareRequest();
      mocks.all
        .mockReturnValueOnce([{ id: 1 }])
        .mockReturnValueOnce([{ furthest: watchedSeconds }]);
      vi.spyOn(console, "log").mockImplementation(() => {});

      if (watchedSeconds < 7200) {
        await expect(requestRefund(actionArgs())).resolves.toBeInstanceOf(
          Response
        );
        expect(mocks.insert).toHaveBeenCalledOnce();
      } else {
        await expect(requestRefund(actionArgs())).rejects.toMatchObject({
          data: "You have watched too much of this course to request a refund.",
          init: { status: 403 },
        });
        expect(mocks.insert).not.toHaveBeenCalled();
      }
    }
  );
});
