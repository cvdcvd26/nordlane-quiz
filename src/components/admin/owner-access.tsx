"use client";

import { createContext, useContext } from "react";

/** Presentation capability only. Every private page/API also checks the current server session. */
export const OwnerAdminContext = createContext(false);
export const useOwnerAdmin = () => useContext(OwnerAdminContext);
