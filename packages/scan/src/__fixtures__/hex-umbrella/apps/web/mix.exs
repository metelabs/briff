defmodule AcmeWeb.MixProject do
  use Mix.Project
  def project, do: [app: :acme_web, deps: deps()]
  defp deps(), do: [{:acme_http, "~> 1.10", hex: :plug}]
end
