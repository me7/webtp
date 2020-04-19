task dev, "run dev of frontend":
  when defined(windows):
    withDir "frontend":
      exec "cmd /c yarn dev"