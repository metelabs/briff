defmodule AcmeTools.MixProject do
  use Mix.Project
  def project, do: [app: :acme_tools, deps: [{:phoenix_html, "~> 2.14", only: :test}]]
end
