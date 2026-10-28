defmodule AcmeDynamic.MixProject do
  use Mix.Project
  def project, do: [app: :acme_dynamic, deps: deps()]
  defp deps do
    [{:plug, "~> 1.10", only: Mix.env()}]
  end
end
